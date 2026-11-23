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

/**
 * The texts a string the author fixed can hold: a literal, a template without
 * values, or a binding only ever set to those (`const L = 'Location'`). Empty
 * when any part is runtime.
 */
function staticTexts(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth = 0,
): string[] {
  const inner = unwrapExpression(node as TSESTree.Expression);
  if (inner.type === AST_NODE_TYPES.Literal) {
    return typeof inner.value === 'string' ? [inner.value] : [];
  }
  if (inner.type === AST_NODE_TYPES.TemplateLiteral && inner.expressions.length === 0) {
    const cooked = inner.quasis[0]?.value.cooked;
    return cooked == null ? [] : [cooked];
  }
  if (inner.type === AST_NODE_TYPES.Identifier && depth < MAX_NAME_DEPTH) {
    return (writtenValues(inner, sourceCode) ?? []).flatMap((value) =>
      staticTexts(value, sourceCode, depth + 1),
    );
  }
  return [];
}

/** The one text a fixed string holds (see {@link staticTexts}), else undefined. */
function staticText(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | undefined {
  const texts = staticTexts(node, sourceCode);
  return texts.length === 1 ? texts[0] : undefined;
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

/** The method name and peeled receiver text of a member call, else null. */
function memberCallParts(
  node: TSESTree.CallExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): { method: string; receiver: string } | null {
  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression) {
    return null;
  }
  const method = propertyName(callee, sourceCode);
  return method === undefined
    ? null
    : { method, receiver: squash(sourceCode.getText(rootReceiver(callee.object, sourceCode))) };
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
  const parts = memberCallParts(node, sourceCode);
  return parts === null
    ? undefined
    : specs.find(
        (spec) =>
          spec.object !== undefined &&
          spec.name === parts.method &&
          squash(spec.object) === parts.receiver,
      );
}

/** True when a header name is, or may be, `Location` in any case. */
function isLocationName(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  return staticTexts(node, sourceCode).some((text) => text.toLowerCase() === 'location');
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
): TSESTree.Expression[] {
  if (node == null || depth > MAX_NAME_DEPTH || node.type === AST_NODE_TYPES.SpreadElement) {
    return [];
  }
  const inner = unwrapExpression(node as TSESTree.Expression);
  switch (inner.type) {
    case AST_NODE_TYPES.ObjectExpression:
      return inner.properties.flatMap((property) => {
        if (property.type === AST_NODE_TYPES.SpreadElement) {
          return holderLocations(property.argument, sourceCode, depth + 1);
        }
        return property.kind === 'init' && isLocationKey(property, sourceCode)
          ? headerValues(property.value)
          : [];
      });
    case AST_NODE_TYPES.ArrayExpression:
      return arrayLocations(inner.elements, sourceCode, depth);
    case AST_NODE_TYPES.NewExpression:
      return inner.callee.type === AST_NODE_TYPES.Identifier &&
        (inner.callee.name === 'Map' || inner.callee.name === 'Headers')
        ? holderLocations(inner.arguments[0], sourceCode, depth + 1)
        : [];
    case AST_NODE_TYPES.CallExpression:
      // `Object.assign({}, base, { Location: url })`
      return isObjectAssignCallee(inner.callee)
        ? inner.arguments.flatMap((source) => holderLocations(source, sourceCode, depth + 1))
        : [];
    case AST_NODE_TYPES.Identifier:
      return [
        ...(writtenValues(inner, sourceCode) ?? []).flatMap((value) =>
          holderLocations(value, sourceCode, depth + 1),
        ),
        ...holderWrites(inner, sourceCode, depth),
      ];
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
): TSESTree.Expression[] {
  return elements.flatMap((element, index) => {
    if (element?.type === AST_NODE_TYPES.SpreadElement) {
      return holderLocations(element.argument, sourceCode, depth + 1);
    }
    const item = element === null ? null : unwrapExpression(element as TSESTree.Expression);
    return item?.type === AST_NODE_TYPES.ArrayExpression
      ? pairValues(item.elements[0], item.elements[1], sourceCode)
      : pairValues(element, elements[index + 1], sourceCode);
  });
}

/** True for the callee `Object.assign`. */
function isObjectAssignCallee(callee: TSESTree.Node): boolean {
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    callee.object.name === 'Object' &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === 'assign'
  );
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

/** What the file writes into the headers holder `name` refers to. */
function holderWrites(
  name: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth: number,
): TSESTree.Expression[] {
  const variable = findVariable(sourceCode.getScope(name), name);
  if (variable === null) {
    return [];
  }
  return variable.references.flatMap((reference) => {
    const member = reference.identifier.parent;
    if (isObjectAssignTarget(reference.identifier)) {
      const call = member as TSESTree.CallExpression;
      return call.arguments
        .slice(1)
        .flatMap((source) => holderLocations(source, sourceCode, depth + 1));
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
    if (parent?.type !== AST_NODE_TYPES.CallExpression || parent.callee !== member) {
      return [];
    }
    const method = propertyName(member, sourceCode);
    if (method !== undefined && HOLDER_SETTERS.has(method)) {
      return pairValues(parent.arguments[0], parent.arguments[1], sourceCode);
    }
    if (method === 'push' || method === 'unshift') {
      return arrayLocations(parent.arguments, sourceCode, depth);
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
  if (parts === null || !responseObjects.has(parts.receiver)) {
    return [];
  }
  const [first, second] = node.arguments;
  if (HEADER_SETTERS.has(parts.method)) {
    return node.arguments.length === 1
      ? holderLocations(first, sourceCode)
      : pairValues(first, second, sourceCode);
  }
  if (parts.method === 'setHeaders') {
    return holderLocations(first, sourceCode);
  }
  if (parts.method === 'writeHead' && node.arguments.length > 1) {
    return holderLocations(node.arguments.at(-1), sourceCode);
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
    return !property.computed &&
      property.key.type === AST_NODE_TYPES.Identifier &&
      property.key.name === 'headers'
      ? holderLocations(property.value, sourceCode)
      : [];
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
  if (node.type === AST_NODE_TYPES.Identifier) {
    const variable = findVariable(sourceCode.getScope(node), node);
    const def = variable?.defs[0];
    if (
      variable?.defs.length === 1 &&
      def?.type === 'Variable' &&
      def.parent.kind === 'const' &&
      def.node.id.type === AST_NODE_TYPES.Identifier &&
      def.node.init !== null
    ) {
      return isSafeTarget(def.node.init, trust, pin, sourceCode, depth + 1);
    }
  }
  return false;
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
          return;
        }
        const urlArg = urlArgumentOf(node, spec);
        const onResponse = spec.object !== undefined && responseObjects.has(squash(spec.object));
        check(urlArg === undefined ? [] : [urlArg], onResponse ? HEADER_PIN : SCRIPT_PIN);
      },
      NewExpression(node: TSESTree.NewExpression): void {
        check(responseInitLocations(node, sourceCode), SCRIPT_PIN);
      },
    };
  },
});
