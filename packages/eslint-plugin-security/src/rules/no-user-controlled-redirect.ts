/*
 * Ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/runtime-boundaries/rules/no-user-controlled-redirect.ts.
 * Changed in the port: configurable `redirectCallees` with a URL argument
 * index (upstream reads argument 0 only, so Express `res.redirect(302, url)`
 * was never seen), and a fixed-origin check in place of upstream's
 * literal-only check, sharing the SSRF rule's trusted-origin vocabulary.
 * Added here: `Location` header writes (`res.location`, `res.set('Location')`,
 * `res.append`, `res.writeHead(302, { Location })` and its array forms,
 * `res.setHeaders`, `new Response(body, { headers })`), `Response.redirect`,
 * sinks after chained response calls, and targets proven to stay on a host
 * (`new URL(url).hostname` checked against an allowlist before the redirect,
 * see `../guards`).
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import { findVariable } from '@typescript-eslint/utils/ast-utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  type HostPinOptions,
  isAllowlistedTarget,
  isFixedOriginPath,
  isHostPinned,
  isLiteralTableRead,
  isSameOriginUrlPath,
  isSameSitePath,
} from '../guards';
import {
  calleeSpecSchema,
  hasFixedOrigin,
  matchCallee,
  normalizeCallees,
  normalizeTrust,
  trustSchemaProperties,
  type UrlCalleeEntry,
  type UrlCalleeSpec,
  type UrlTrust,
  type UrlTrustOptions,
  urlArgumentOf,
} from '../url-origin';
import { squash, unwrapExpression } from '../utils';
import {
  callArguments,
  flowStep,
  flowSteps,
  handlerRole,
  importedBinding,
  objectLiteralOf,
  withArguments,
} from '../value-flow';

const RULE_NAME = 'no-user-controlled-redirect';

export interface NoUserControlledRedirectOptions extends UrlTrustOptions {
  /** Call shapes that redirect. Replaces the defaults when set. */
  readonly redirectCallees?: readonly UrlCalleeEntry[];
  /**
   * Receivers whose header writes (`set`, `header`, `headers`, `setHeader`,
   * `append`, `appendHeader`, `setHeaders`, `writeHead`) are checked for a
   * `Location` header. Replaces the defaults when set.
   */
  readonly responseObjects?: readonly string[];
}

type RuleOptions = [NoUserControlledRedirectOptions];
type MessageIds = 'userControlledRedirect';

export const DEFAULT_REDIRECT_CALLEES: readonly UrlCalleeSpec[] = [
  // Next.js `redirect()` from `next/navigation`, Remix / React Router `redirect()`.
  { name: 'redirect' },
  { object: 'NextResponse', name: 'redirect' },
  // Fastify v5: `reply.redirect(url, code?)`.
  { object: 'reply', name: 'redirect' },
  // Express: `res.redirect(url)` or `res.redirect(status, url)`.
  { object: 'res', name: 'redirect', urlArgument: 'last' },
  { object: 'response', name: 'redirect', urlArgument: 'last' },
  // Express: `res.location(url)` sets the header a 3xx status then follows.
  { object: 'res', name: 'location' },
  { object: 'response', name: 'location' },
  // Fetch API: `Response.redirect(url, status?)` in route handlers and workers.
  { object: 'Response', name: 'redirect' },
];

/** Receivers whose header writes are checked for `Location`. */
export const DEFAULT_RESPONSE_OBJECTS: readonly string[] = ['res', 'response', 'reply'];

/**
 * Methods that set a header: `res.set(name, value)`, `reply.header(name, value)`,
 * `res.append(name, value)`, or one object of headers (`res.set({ ... })`,
 * `reply.headers({ ... })`).
 */
const HEADER_SETTERS: ReadonlySet<string> = new Set([
  'set',
  'header',
  'headers',
  'setHeader',
  'append',
  'appendHeader',
]);

/** Constructors whose `init.headers` can carry a `Location` header. */
const RESPONSE_CONSTRUCTORS: ReadonlySet<string> = new Set(['Response', 'NextResponse']);

/** Calls on a headers holder that add a header: `headers.set(name, value)`. */
const HOLDER_SETTERS: ReadonlySet<string> = new Set(['set', 'append']);

/**
 * Response methods that return the response itself, so a sink after them
 * (`res.status(302).redirect(url)`) is a sink on the response.
 */
const CHAINABLE: ReadonlySet<string> = new Set([
  'status',
  'code',
  'type',
  'set',
  'header',
  'headers',
  'append',
  'cookie',
  'clearCookie',
  'vary',
  'links',
  'location',
]);

const MAX_NAME_DEPTH = 8;

/**
 * Every value a local binding is set to (its initializer and each plain `=`
 * write), or undefined when one cannot be read: a parameter, an import, a
 * destructuring, or a compound write such as `+=`.
 */
function writtenValues(
  name: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] | undefined {
  const variable = findVariable(sourceCode.getScope(name), name);
  const def = variable?.defs[0];
  if (
    variable === null ||
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier
  ) {
    return undefined;
  }
  const values: TSESTree.Expression[] = [];
  for (const reference of variable.references) {
    if (!reference.isWrite()) {
      continue;
    }
    const parent = reference.identifier.parent;
    const plain =
      reference.init === true ||
      (parent?.type === AST_NODE_TYPES.AssignmentExpression && parent.operator === '=');
    if (!plain || reference.writeExpr == null) {
      return undefined;
    }
    values.push(reference.writeExpr as TSESTree.Expression);
  }
  return values;
}

const MAX_JOINED_TEXTS = 16;

/**
 * The one text a string the author fixed holds: a literal, a template, a `+`
 * or a binding only ever set to those (`const L = 'Location'`), with runtime
 * values left out (see {@link nameShapes}); else undefined.
 */
function staticText(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | undefined {
  const texts = nameShapes(node, sourceCode, new Map())?.filter((shape) => !shape.includes(RUNTIME_PIECE));
  return texts?.length === 1 ? texts[0] : undefined;
}

/** The name of a member's property: `res.set`, `res['set']`, `res[SET]`. */
function propertyName(
  member: TSESTree.MemberExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | undefined {
  if (!member.computed) {
    return member.property.type === AST_NODE_TYPES.Identifier ? member.property.name : undefined;
  }
  return staticText(member.property, sourceCode);
}

/** The receiver with response-returning calls peeled: `res.status(302)` gives `res`. */
function rootReceiver(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.CallExpression &&
    current.callee.type === AST_NODE_TYPES.MemberExpression &&
    CHAINABLE.has(propertyName(current.callee, sourceCode) ?? '')
  ) {
    current = current.callee.object;
  }
  return current;
}

/**
 * The method name and the texts a member call's peeled receiver goes by: as
 * written, and `res` for a handler's response parameter under another name
 * (`(a, b) => b.redirect(url)`, a Nest `@Res()`; see `handlerRole`).
 */
function memberCallParts(
  node: TSESTree.CallExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): { method: string; receivers: string[] } | null {
  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression) {
    return null;
  }
  const method = propertyName(callee, sourceCode);
  if (method === undefined) {
    return null;
  }
  const receiver = rootReceiver(callee.object, sourceCode);
  const receivers = [squash(sourceCode.getText(receiver))];
  if (receiver.type === AST_NODE_TYPES.Identifier && handlerRole(receiver, sourceCode) === 'response') {
    receivers.push('res');
  }
  return { method, receivers };
}

/** True when `name` is bound to an import from `@sveltejs/kit` (a named or a namespace import). */
function isKitImport(name: TSESTree.Identifier, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  return importedBinding(name, sourceCode)?.module === '@sveltejs/kit';
}

/** `matchCallee`, also through a chain of response-returning calls on the receiver. */
function matchRedirectCallee(
  node: TSESTree.CallExpression,
  specs: readonly UrlCalleeSpec[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): UrlCalleeSpec | undefined {
  const direct = matchCallee(node, specs, sourceCode);
  if (direct !== undefined) {
    return direct;
  }
  // `kit.redirect(303, url)` through `import * as kit from '@sveltejs/kit'`
  // is the bare `redirect` sink.
  const callee = node.callee;
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    propertyName(callee, sourceCode) === 'redirect' &&
    isKitImport(callee.object, sourceCode)
  ) {
    return specs.find((spec) => spec.object === undefined && spec.name === 'redirect');
  }
  const parts = memberCallParts(node, sourceCode);
  return parts === null
    ? undefined
    : specs.find(
        (spec) =>
          spec.object !== undefined &&
          spec.name === parts.method &&
          parts.receivers.includes(squash(spec.object)),
      );
}

/** True when a call argument is a number literal: a status code, never a target. */
function isNumberArgument(node: TSESTree.CallExpressionArgument | undefined): boolean {
  const inner =
    node === undefined || node.type === AST_NODE_TYPES.SpreadElement ? undefined : unwrapExpression(node);
  return inner?.type === AST_NODE_TYPES.Literal && typeof inner.value === 'number';
}

/**
 * The redirect targets a call names. A status-first call reads argument 1:
 * any call whose argument 0 is a number literal, and SvelteKit's
 * `redirect(status, location)` (known by its import from `@sveltejs/kit`)
 * when argument 1 exists and is not itself a number literal. A kit call with
 * one argument, or a number literal second (`redirect(next)`,
 * `redirect(next, 302)`, which SvelteKit rejects at run time), reads
 * argument 0. Specs that name another argument are left alone.
 */
function redirectTargets(
  node: TSESTree.CallExpression,
  spec: UrlCalleeSpec,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  const read = (urlArgument: number): TSESTree.Expression[] => {
    const target = urlArgumentOf(node, { ...spec, urlArgument });
    return target === undefined ? [] : [target];
  };
  if (spec.urlArgument !== undefined && spec.urlArgument !== 0) {
    const target = urlArgumentOf(node, spec);
    return target === undefined ? [] : [target];
  }
  const [first, second] = node.arguments;
  if (isNumberArgument(first)) {
    return read(1);
  }
  const callee = node.callee;
  const root =
    callee.type === AST_NODE_TYPES.MemberExpression ? callee.object : callee;
  const fromKit = root.type === AST_NODE_TYPES.Identifier && isKitImport(root, sourceCode);
  return read(fromKit && second !== undefined && !isNumberArgument(second) ? 1 : 0);
}

/** Stands for a runtime piece of a header name in {@link nameShapes}. */
const RUNTIME_PIECE = '\u0000';

type ShapeMemo = Map<object, readonly string[] | null | 'pending'>;

/**
 * The shapes a header name can take: its author text, with
 * {@link RUNTIME_PIECE} for each runtime piece (`'Loc' + n` is `Loc\0`).
 * Null when the shapes are too many to list, which may be anything. A binding
 * is read once per name; one met again inside its own values is runtime.
 */
function nameShapes(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
  memo: ShapeMemo,
  depth = 0,
): readonly string[] | null {
  const inner = unwrapExpression(node as TSESTree.Expression);
  if (inner.type === AST_NODE_TYPES.Literal) {
    return typeof inner.value === 'string' ? [inner.value] : [String(inner.value)];
  }
  if (depth >= MAX_NAME_DEPTH) {
    return [RUNTIME_PIECE];
  }
  if (inner.type === AST_NODE_TYPES.TemplateLiteral) {
    const pieces: (string | TSESTree.Node)[] = [];
    inner.quasis.forEach((quasi, index) => {
      pieces.push(quasi.value.cooked ?? quasi.value.raw);
      const expression = inner.expressions[index];
      if (expression !== undefined) {
        pieces.push(expression);
      }
    });
    return joinedShapes(pieces, sourceCode, memo, depth);
  }
  if (inner.type === AST_NODE_TYPES.BinaryExpression && inner.operator === '+') {
    return joinedShapes([inner.left, inner.right], sourceCode, memo, depth);
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return [RUNTIME_PIECE];
  }
  const variable = findVariable(sourceCode.getScope(inner), inner);
  const values = writtenValues(inner, sourceCode);
  if (variable === null || values === undefined) {
    return [RUNTIME_PIECE];
  }
  const known = memo.get(variable);
  if (known !== undefined) {
    return known === 'pending' ? [RUNTIME_PIECE] : known;
  }
  memo.set(variable, 'pending');
  let shapes: string[] | null = [];
  for (const value of values) {
    const more = nameShapes(value, sourceCode, memo, depth + 1);
    shapes = more === null ? null : [...new Set([...shapes, ...more])];
    if (shapes === null || shapes.length > MAX_JOINED_TEXTS) {
      shapes = null;
      break;
    }
  }
  memo.set(variable, shapes);
  return shapes;
}

/** Every shape a header name joined from pieces can take, or null past {@link MAX_JOINED_TEXTS}. */
function joinedShapes(
  pieces: readonly (string | TSESTree.Node)[],
  sourceCode: Readonly<TSESLint.SourceCode>,
  memo: ShapeMemo,
  depth: number,
): readonly string[] | null {
  let shapes = [''];
  for (const piece of pieces) {
    const options = typeof piece === 'string' ? [piece] : nameShapes(piece, sourceCode, memo, depth + 1);
    if (options === null) {
      return null;
    }
    shapes = [...new Set(shapes.flatMap((shape) => options.map((option) => shape + option)))];
    if (shapes.length > MAX_JOINED_TEXTS) {
      return null;
    }
  }
  return shapes;
}

/** True when a name shape can read `location` in any case, each runtime piece standing for any text. */
function shapeCanBeLocation(shape: string): boolean {
  const pattern = shape
    .toLowerCase()
    .split(RUNTIME_PIECE)
    .map((text) => text.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&'))
    .join('[^]*');
  return new RegExp(`^${pattern}$`, 'u').test('location');
}

/**
 * True when a header name is, or may be, `Location` in any case: a fixed
 * name, a name joined from pieces whose author text fits `Location`
 * (`'Loc' + n`), or one with too many fixed spellings to list. A name that
 * is runtime as a whole (`res.set(name, value)`) is not read.
 */
function isLocationName(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const shapes = nameShapes(node, sourceCode, new Map());
  return (
    shapes === null ||
    shapes.some((shape) => !/^\u0000*$/u.test(shape) && shapeCanBeLocation(shape))
  );
}

/** True when an object key names `Location`: `Location`, `'location'`, `[L]`. */
function isLocationKey(
  property: TSESTree.Property,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name.toLowerCase() === 'location';
  }
  return isLocationName(property.key, sourceCode);
}

/** A header value, each element of an array value on its own (`setHeader(n, [a, b])`). */
function headerValues(node: TSESTree.Node | undefined | null): TSESTree.Expression[] {
  if (
    node === undefined ||
    node === null ||
    node.type === AST_NODE_TYPES.SpreadElement ||
    node.type === AST_NODE_TYPES.AssignmentPattern ||
    node.type === AST_NODE_TYPES.ObjectPattern ||
    node.type === AST_NODE_TYPES.ArrayPattern ||
    node.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression ||
    (node.type === AST_NODE_TYPES.Identifier && node.name === 'undefined')
  ) {
    return [];
  }
  const expression = node as TSESTree.Expression;
  const inner = unwrapExpression(expression);
  if (inner.type === AST_NODE_TYPES.ArrayExpression) {
    return inner.elements.flatMap((element) => headerValues(element));
  }
  return [expression];
}

/** The values a `name, value` pair sets when the name is `Location`. */
function pairValues(
  name: TSESTree.Node | null | undefined,
  value: TSESTree.Node | null | undefined,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  return name != null &&
    name.type !== AST_NODE_TYPES.SpreadElement &&
    isLocationName(name, sourceCode)
    ? headerValues(value)
    : [];
}

/**
 * The `Location` values a headers holder sets: an object literal
 * (`{ Location: url }`, `{ [L]: url }`, also through a spread), Node's array
 * forms (`['Location', url]` and `[['Location', url]]`), `new Map(...)` or
 * `new Headers(...)` around one of those, or a `const` holding any of them,
 * with what the file later writes into it (`h.Location = url`,
 * `h.set('Location', url)`, `h.push('Location', url)`).
 */
function holderLocations(
  node: TSESTree.Node | undefined | null,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth = 0,
  visits: Visits = newVisits(),
): TSESTree.Expression[] {
  if (node == null || depth > MAX_NAME_DEPTH || node.type === AST_NODE_TYPES.SpreadElement) {
    return [];
  }
  const inner = unwrapExpression(node as TSESTree.Expression);
  switch (inner.type) {
    case AST_NODE_TYPES.ObjectExpression:
      return inner.properties.flatMap((property) => {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          return holderLocations(property.argument, sourceCode, depth + 1, visits);
        }
        if (property.kind === 'set' || !isLocationKey(property, sourceCode)) {
          return [];
        }
        return property.kind === 'get' ? returnedValues(property.value) : headerValues(property.value);
      });
    case AST_NODE_TYPES.ConditionalExpression:
      return [
        ...holderLocations(inner.consequent, sourceCode, depth + 1, visits),
        ...holderLocations(inner.alternate, sourceCode, depth + 1, visits),
      ];
    case AST_NODE_TYPES.LogicalExpression:
      return [
        ...holderLocations(inner.left, sourceCode, depth + 1, visits),
        ...holderLocations(inner.right, sourceCode, depth + 1, visits),
      ];
    case AST_NODE_TYPES.ArrayExpression:
      return arrayLocations(inner.elements, sourceCode, depth, visits);
    case AST_NODE_TYPES.NewExpression:
      return inner.callee.type === AST_NODE_TYPES.Identifier &&
        (inner.callee.name === 'Map' || inner.callee.name === 'Headers')
        ? holderLocations(inner.arguments[0], sourceCode, depth + 1, visits)
        : [];
    case AST_NODE_TYPES.CallExpression:
      // `Object.assign({}, base, { Location: url })`
      if (isObjectAssignCallee(inner.callee)) {
        return inner.arguments.flatMap((source) => holderLocations(source, sourceCode, depth + 1, visits));
      }
      // `Object.fromEntries([['Location', url]])`
      return isStaticCall(inner, 'Object', 'fromEntries')
        ? holderLocations(inner.arguments[0], sourceCode, depth + 1, visits)
        : [];
    case AST_NODE_TYPES.Identifier: {
      // A holder already read at this depth or above adds nothing new: `let a = hd; hd = a`.
      const variable = findVariable(sourceCode.getScope(inner), inner);
      if (variable !== null && !firstVisit(visits.values, variable, depth)) {
        return [];
      }
      return [
        ...(writtenValues(inner, sourceCode) ?? []).flatMap((value) =>
          holderLocations(value, sourceCode, depth + 1, visits),
        ),
        ...holderWrites(inner, sourceCode, depth, visits),
      ];
    }
    default:
      return [];
  }
}

/**
 * The `Location` values in Node's array forms of headers: name and value side
 * by side (`['Location', url]`) or as pairs (`[['Location', url]]`).
 */
function arrayLocations(
  elements: readonly (TSESTree.Node | null)[],
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth: number,
  visits: Visits,
): TSESTree.Expression[] {
  return elements.flatMap((element, index) => {
    if (element?.type === AST_NODE_TYPES.SpreadElement) {
      return holderLocations(element.argument, sourceCode, depth + 1, visits);
    }
    const item = element === null ? null : unwrapExpression(element as TSESTree.Expression);
    return item?.type === AST_NODE_TYPES.ArrayExpression
      ? pairValues(item.elements[0], item.elements[1], sourceCode)
      : pairValues(element, elements[index + 1], sourceCode);
  });
}

/** True for the callee `object.name`: `Object.assign`, `Reflect.set`. */
function isStaticCallee(callee: TSESTree.Node, object: string, name: string): boolean {
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === object &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === name
  );
}

/** True for a call `object.name(...)`. */
function isStaticCall(node: TSESTree.Node, object: string, name: string): node is TSESTree.CallExpression {
  return node.type === AST_NODE_TYPES.CallExpression && isStaticCallee(node.callee, object, name);
}

/** True for the callee `Object.assign`. */
function isObjectAssignCallee(callee: TSESTree.Node): boolean {
  return isStaticCallee(callee, 'Object', 'assign');
}

/**
 * The values a getter returns: an arrow's expression body, or each `return`
 * directly in a function body. A `return` nested in a block is not read.
 */
function returnedValues(fn: TSESTree.Node): TSESTree.Expression[] {
  if (fn.type !== AST_NODE_TYPES.FunctionExpression && fn.type !== AST_NODE_TYPES.ArrowFunctionExpression) {
    return [];
  }
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return headerValues(fn.body);
  }
  return fn.body.body.flatMap((statement) =>
    statement.type === AST_NODE_TYPES.ReturnStatement ? headerValues(statement.argument) : [],
  );
}

/** The `Location` values of an `Object.defineProperty` descriptor: its `value`, or what its `get` returns. */
function descriptorValues(
  node: TSESTree.Node | undefined,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  const descriptor = node === undefined ? null : objectLiteralOf(node, sourceCode, 'taint');
  if (descriptor === null) {
    return [];
  }
  return descriptor.properties.flatMap((property) => {
    if (property.type !== AST_NODE_TYPES.Property) {
      return [];
    }
    const key = keyName(property, sourceCode);
    if (key === 'value' && property.kind === 'init') {
      return headerValues(property.value);
    }
    return key === 'get' && property.kind === 'init' ? returnedValues(property.value) : [];
  });
}

/** The name of an object key: `headers`, `'headers'`, `['headers']`, `[H]`. */
function keyName(property: TSESTree.Property, sourceCode: Readonly<TSESLint.SourceCode>): string | undefined {
  return !property.computed && property.key.type === AST_NODE_TYPES.Identifier
    ? property.key.name
    : staticText(property.key, sourceCode);
}

/** True when `node` is the target of `Object.assign(node, ...)`. */
function isObjectAssignTarget(node: TSESTree.Node): boolean {
  const call = node.parent;
  return (
    call?.type === AST_NODE_TYPES.CallExpression &&
    call.arguments[0] === node &&
    isObjectAssignCallee(call.callee)
  );
}

/**
 * The bindings a headers walk has read, each with the least depth it was read
 * at. Every walk takes the union of what it finds, so a binding read again at
 * that depth or deeper adds nothing and is skipped; this keeps cyclic aliases
 * (`let a = hd; hd = a`) from multiplying the work.
 */
interface Visits {
  readonly values: Map<object, number>;
  readonly writes: Map<object, number>;
}

function newVisits(): Visits {
  return { values: new Map(), writes: new Map() };
}

/** Records a visit of `key` at `depth`; false when it was read before at that depth or above. */
function firstVisit(seen: Map<object, number>, key: object, depth: number): boolean {
  const before = seen.get(key);
  if (before !== undefined && before <= depth) {
    return false;
  }
  seen.set(key, depth);
  return true;
}

/** The binding `node` is copied into as a whole: `a` in `const a = hd` or `a = hd`. */
function aliasOf(node: TSESTree.Identifier): TSESTree.Identifier | null {
  const parent = node.parent;
  if (
    parent?.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === node &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id;
  }
  return parent?.type === AST_NODE_TYPES.AssignmentExpression &&
    parent.operator === '=' &&
    parent.right === node &&
    parent.left.type === AST_NODE_TYPES.Identifier
    ? parent.left
    : null;
}

/** What the file writes into the headers holder `name` refers to. */
function holderWrites(
  name: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth: number,
  visits: Visits,
): TSESTree.Expression[] {
  const variable = findVariable(sourceCode.getScope(name), name);
  if (variable === null || depth > MAX_NAME_DEPTH || !firstVisit(visits.writes, variable, depth)) {
    return [];
  }
  return variable.references.flatMap((reference) => {
    const member = reference.identifier.parent;
    // An alias writes into the same holder: `const a = hd; a.Location = url`.
    const alias = reference.identifier.type === AST_NODE_TYPES.Identifier ? aliasOf(reference.identifier) : null;
    if (alias !== null) {
      return holderWrites(alias, sourceCode, depth + 1, visits);
    }
    if (
      member?.type === AST_NODE_TYPES.CallExpression &&
      member.arguments[0] === reference.identifier
    ) {
      // `Reflect.set(hd, 'Location', url)`
      if (isStaticCallee(member.callee, 'Reflect', 'set')) {
        return pairValues(member.arguments[1], member.arguments[2], sourceCode);
      }
      // `Object.defineProperty(hd, 'Location', { value: url })`
      if (isStaticCallee(member.callee, 'Object', 'defineProperty')) {
        const [, key, descriptor] = member.arguments;
        return key !== undefined && key.type !== AST_NODE_TYPES.SpreadElement && isLocationName(key, sourceCode)
          ? descriptorValues(descriptor, sourceCode)
          : [];
      }
    }
    if (isObjectAssignTarget(reference.identifier)) {
      const call = member as TSESTree.CallExpression;
      return call.arguments
        .slice(1)
        .flatMap((source) => holderLocations(source, sourceCode, depth + 1, visits));
    }
    if (
      member?.type !== AST_NODE_TYPES.MemberExpression ||
      member.object !== reference.identifier
    ) {
      return [];
    }
    const parent = member.parent;
    if (
      parent?.type === AST_NODE_TYPES.AssignmentExpression &&
      parent.left === member &&
      (member.computed
        ? isLocationName(member.property, sourceCode)
        : member.property.type === AST_NODE_TYPES.Identifier &&
          member.property.name.toLowerCase() === 'location')
    ) {
      return headerValues(parent.right);
    }
    // An index write of a pair into Node's array form: `hd[0] = ['Location', url]`.
    if (parent?.type === AST_NODE_TYPES.AssignmentExpression && parent.left === member && member.computed) {
      return arrayLocations([parent.right], sourceCode, depth, visits);
    }
    if (parent?.type !== AST_NODE_TYPES.CallExpression || parent.callee !== member) {
      return [];
    }
    const method = propertyName(member, sourceCode);
    if (method !== undefined && HOLDER_SETTERS.has(method)) {
      return pairValues(parent.arguments[0], parent.arguments[1], sourceCode);
    }
    if (method === 'push' || method === 'unshift') {
      return arrayLocations(parent.arguments, sourceCode, depth, visits);
    }
    return [];
  });
}

/**
 * The `Location` values a header write sets on a response object:
 * `res.set('Location', url)`, `res.header('location', url)`,
 * `res.setHeader(L, url)`, `res.append('Location', url)`,
 * `res.set({ Location: url })`, `res.setHeaders(new Map(...))` and
 * `res.writeHead(302, { Location: url })` (or Node's array forms), also after
 * chained calls.
 */
function locationHeaderValues(
  node: TSESTree.CallExpression,
  responseObjects: ReadonlySet<string>,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  const parts = memberCallParts(node, sourceCode);
  if (parts === null || !parts.receivers.some((receiver) => responseObjects.has(receiver))) {
    return [];
  }
  // `res.setHeader('Location', ...[url])` reads the spread elements in place.
  const args = callArguments(node.arguments, sourceCode);
  const [first, second] = args;
  if (HEADER_SETTERS.has(parts.method)) {
    return args.length === 1
      ? holderLocations(first, sourceCode)
      : pairValues(first, second, sourceCode);
  }
  if (parts.method === 'setHeaders') {
    return holderLocations(first, sourceCode);
  }
  if (parts.method === 'writeHead') {
    // `writeHead(status, message?, headers?)`, also with a trailing `undefined`.
    return args.slice(1).flatMap((arg) => holderLocations(arg, sourceCode));
  }
  return [];
}

/** The `Location` values of `new Response(body, { headers })` or `new NextResponse(...)`. */
function responseInitLocations(
  node: TSESTree.NewExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  if (
    node.callee.type !== AST_NODE_TYPES.Identifier ||
    !RESPONSE_CONSTRUCTORS.has(node.callee.name)
  ) {
    return [];
  }
  return initHeaders(node.arguments[1], sourceCode, 0);
}

/** The `Location` values of `Response.json(data, init)` or `NextResponse.json(data, init)`. */
function jsonInitLocations(
  node: TSESTree.CallExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  return [...RESPONSE_CONSTRUCTORS].some((object) => isStaticCallee(node.callee, object, 'json'))
    ? initHeaders(node.arguments[1], sourceCode, 0)
    : [];
}

/**
 * True when `node` holds a Fetch response: a receiver in `responseObjects`,
 * or a value that comes from `new Response(...)`, `new NextResponse(...)` or a
 * static call on either (`NextResponse.next()`, `Response.json(data)`).
 */
function isFetchResponse(
  node: TSESTree.Node,
  responseObjects: ReadonlySet<string>,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  if (responseObjects.has(squash(sourceCode.getText(node)))) {
    return true;
  }
  return flowSteps(node, node, sourceCode, 'taint').some(({ node: step }) => {
    const inner = unwrapExpression(step as TSESTree.Expression);
    if (inner.type === AST_NODE_TYPES.NewExpression) {
      return inner.callee.type === AST_NODE_TYPES.Identifier && RESPONSE_CONSTRUCTORS.has(inner.callee.name);
    }
    return (
      inner.type === AST_NODE_TYPES.CallExpression &&
      inner.callee.type === AST_NODE_TYPES.MemberExpression &&
      inner.callee.object.type === AST_NODE_TYPES.Identifier &&
      RESPONSE_CONSTRUCTORS.has(inner.callee.object.name)
    );
  });
}

/** `r` in `const { headers } = r` when `name` is that `headers` binding, else null. */
function destructuredHeadersSource(
  name: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression | null {
  const def = findVariable(sourceCode.getScope(name), name)?.defs[0];
  if (def?.type !== 'Variable' || def.node.id.type !== AST_NODE_TYPES.ObjectPattern || def.node.init === null) {
    return null;
  }
  const taken = def.node.id.properties.some(
    (property) =>
      property.type === AST_NODE_TYPES.Property &&
      property.value === def.name &&
      keyName(property, sourceCode) === 'headers',
  );
  return taken ? def.node.init : null;
}

/**
 * The `Location` values of `r.headers.set('Location', url)` on a Fetch
 * response `r`, also when `r.headers` reaches the call through a binding, a
 * helper or a container (`const h = r.headers; h.set(...)`).
 */
function responseHeadersLocations(
  node: TSESTree.CallExpression,
  responseObjects: ReadonlySet<string>,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression[] {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    !HOLDER_SETTERS.has(propertyName(callee, sourceCode) ?? '') ||
    !flowSteps(callee.object, callee.object, sourceCode, 'taint').some(({ node: step }) => {
      const headers = unwrapExpression(step as TSESTree.Expression);
      if (headers.type === AST_NODE_TYPES.Identifier) {
        const response = destructuredHeadersSource(headers, sourceCode);
        return response !== null && isFetchResponse(response, responseObjects, sourceCode);
      }
      return (
        headers.type === AST_NODE_TYPES.MemberExpression &&
        propertyName(headers, sourceCode) === 'headers' &&
        isFetchResponse(headers.object, responseObjects, sourceCode)
      );
    })
  ) {
    return [];
  }
  const [name, value] = callArguments(node.arguments, sourceCode);
  return pairValues(name, value, sourceCode);
}

/** The `Location` values of the `headers` in a `Response` init object, or a binding holding one. */
function initHeaders(
  node: TSESTree.Node | undefined,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth: number,
): TSESTree.Expression[] {
  if (node === undefined || node.type === AST_NODE_TYPES.SpreadElement || depth > MAX_NAME_DEPTH) {
    return [];
  }
  const init = unwrapExpression(node as TSESTree.Expression);
  if (init.type === AST_NODE_TYPES.Identifier) {
    return (writtenValues(init, sourceCode) ?? []).flatMap((value) =>
      initHeaders(value, sourceCode, depth + 1),
    );
  }
  if (init.type !== AST_NODE_TYPES.ObjectExpression) {
    return [];
  }
  return init.properties.flatMap((property) => {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      return initHeaders(property.argument, sourceCode, depth + 1);
    }
    return keyName(property, sourceCode) === 'headers' ? holderLocations(property.value, sourceCode) : [];
  });
}

const MAX_TARGET_DEPTH = 8;

/**
 * True when a redirect target is proven to stay on a fixed origin. Read at the
 * value itself, so a check in `ok ? target : '/'` counts for `target`; a
 * `const` holding the target is followed, and each branch of a `?:` must be
 * safe on its own. `pin` says which host checks count (see `isHostPinned`).
 */
function isSafeTarget(
  node: TSESTree.Expression,
  trust: UrlTrust,
  pin: HostPinOptions,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth = 0,
): boolean {
  if (depth > MAX_TARGET_DEPTH) {
    return false;
  }
  if (
    hasFixedOrigin(node, trust, sourceCode) ||
    isHostPinned(node, node, sourceCode, pin) ||
    isSameSitePath(node, node, sourceCode) ||
    isLiteralTableRead(node, sourceCode) ||
    isAllowlistedTarget(node, node, sourceCode) ||
    isFixedOriginPath(node, node, sourceCode) ||
    isSameOriginUrlPath(node, node, sourceCode)
  ) {
    return true;
  }
  if (node.type === AST_NODE_TYPES.ConditionalExpression) {
    return (
      isSafeTarget(node.consequent, trust, pin, sourceCode, depth + 1) &&
      isSafeTarget(node.alternate, trust, pin, sourceCode, depth + 1)
    );
  }
  // The value it holds exactly: a `const` initializer, a helper's argument,
  // an object property or array element, a callback's value, `x!` or
  // `x as string` (`../value-flow`).
  const next = flowStep(node, node, sourceCode);
  return next !== null && isSafeTarget(next.node as TSESTree.Expression, trust, pin, sourceCode, depth + 1);
}

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    redirectCallees: {
      type: 'array',
      items: calleeSpecSchema,
      description:
        'Call shapes that redirect: a string such as `res.redirect`, or an object with `name`, `object`, `urlArgument` and `urlProperty`. Replaces the defaults.',
    },
    responseObjects: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Receivers whose header writes (`set`, `header`, `headers`, `setHeader`, `append`, `appendHeader`, `setHeaders`, `writeHead`) are checked for a `Location` header. A host check counts only for these receivers; other sinks need an `origin` check. Replaces the defaults (`res`, `response`, `reply`).',
    },
    ...trustSchemaProperties,
  },
};

export const noUserControlledRedirectRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow redirects whose target origin is not fixed at authoring time: a user-controlled target is an open redirect.',
      cwe: ['CWE-601'],
      owasp: ['A01:2021'],
      securitySeverity: 6.1,
    },
    schema: [optionSchema],
    messages: {
      userControlledRedirect:
        'Redirect target `{{url}}` must have a fixed origin. Use a literal or a same-origin path (`/users/${id}`), or build it from a `trustedOrigins` base closed by `/` or a configured sanitizer: `${appUrl}${returnTo}` lets `returnTo = "@evil.com"` move the host.',
    },
  },
  defaultOptions: [
    {
      redirectCallees: DEFAULT_REDIRECT_CALLEES,
      responseObjects: DEFAULT_RESPONSE_OBJECTS,
      trustedOrigins: [],
      sanitizers: [],
      trustedPaths: [],
    },
  ],
  create(context, [options]) {
    const callees = normalizeCallees(options.redirectCallees ?? DEFAULT_REDIRECT_CALLEES);
    const trust = normalizeTrust(options);
    const responseObjects = new Set(
      (options.responseObjects ?? DEFAULT_RESPONSE_OBJECTS).map(squash),
    );
    const sourceCode = context.sourceCode;

    /*
     * A `Location` header a response object writes is followed by the browser
     * itself, which refuses a redirect to a scheme other than http(s), so a
     * check on the host is enough there. Any other sink (`redirect()` in a
     * framework with a client-side router, `Response.redirect`) may hand the
     * URL to script, where `javascript://app.example.com/%0aalert(1)` runs
     * with an allowlisted host: only an `origin` check counts.
     */
    const HEADER_PIN: HostPinOptions = {};
    const SCRIPT_PIN: HostPinOptions = { originOnly: true };

    // A value a headers holder carries is reported once, however many writes reach it.
    const reported = new Set<TSESTree.Node>();
    const check = (targets: readonly TSESTree.Expression[], pin: HostPinOptions): void => {
      for (const target of targets) {
        if (!reported.has(target) && !isSafeTarget(target, trust, pin, sourceCode)) {
          reported.add(target);
          context.report({
            node: target,
            messageId: 'userControlledRedirect',
            data: { url: sourceCode.getText(target) },
          });
        }
      }
    };

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const spec = matchRedirectCallee(node, callees, sourceCode);
        if (spec === undefined) {
          check(locationHeaderValues(node, responseObjects, sourceCode), HEADER_PIN);
          check(
            [
              ...responseHeadersLocations(node, responseObjects, sourceCode),
              ...jsonInitLocations(node, sourceCode),
            ],
            SCRIPT_PIN,
          );
          return;
        }
        const call = withArguments(node, sourceCode);
        const onResponse = spec.object !== undefined && responseObjects.has(squash(spec.object));
        check(redirectTargets(call, spec, sourceCode), onResponse ? HEADER_PIN : SCRIPT_PIN);
      },
      NewExpression(node: TSESTree.NewExpression): void {
        check(responseInitLocations(node, sourceCode), SCRIPT_PIN);
      },
    };
  },
});
