/*
 * Portions ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/boundary-utils.ts (`hasFixedOrigin`, `prefixPinsOrigin`).
 * Extended here with const resolution, `+` concatenation, `new URL(...)`, and the
 * configurable trusted-origin / sanitizer / trusted-path vocabulary.
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

/**
 * One call shape that sends a request to (or redirects to) a URL.
 *
 * `object` is the receiver's source text (`res`, `this.http`, `NextResponse`);
 * omit it for a bare function call (`fetch(...)`, `redirect(...)`). The URL is
 * read from `urlArgument`: an index, or `'last'` for APIs whose URL trails an
 * optional status (`res.redirect(302, url)` and `res.redirect(url)` alike).
 * When that argument is an object literal, the URL is its `urlProperty`
 * (default `href`), and an object without one is not a URL at all: TanStack
 * Router's `redirect({ to: '/dashboard' })` names a route, not a location.
 */
export interface UrlCalleeSpec {
  readonly name: string;
  readonly object?: string;
  readonly urlArgument?: number | 'last';
  readonly urlProperty?: string;
}

const DEFAULT_URL_PROPERTY = 'href';

/** The shared vocabulary both SSRF and open-redirect rules accept. */
export interface UrlTrustOptions {
  /**
   * Expressions whose value is a URL with a fixed origin, matched by source
   * text. An entry ending in `()` matches any call to that callee, whatever
   * its arguments (`getApiBaseUrl()`, `buildErrorRedirect()`).
   */
  readonly trustedOrigins?: readonly string[];
  /**
   * Functions (callee source text) whose result is a safe same-origin path:
   * allowed on its own, and allowed directly after a trusted origin.
   */
  readonly sanitizers?: readonly string[];
  /**
   * Expressions (source text) known to hold a safe same-origin path, typically
   * an imported path constant the rule cannot see into: `AUTH_CALLBACK_PATH`.
   */
  readonly trustedPaths?: readonly string[];
}

export const calleeSpecSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string' },
    object: { type: 'string' },
    urlArgument: {
      oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', enum: ['last'] }],
    },
    urlProperty: { type: 'string' },
  },
};

export const trustSchemaProperties: Record<string, JSONSchema4> = {
  trustedOrigins: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  sanitizers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  trustedPaths: { type: 'array', items: { type: 'string' }, uniqueItems: true },
};

/** Normalized, lookup-ready form of {@link UrlTrustOptions}. */
export interface UrlTrust {
  readonly originTexts: ReadonlySet<string>;
  readonly originCallees: ReadonlySet<string>;
  readonly sanitizerCallees: ReadonlySet<string>;
  readonly pathTexts: ReadonlySet<string>;
}

/** Drops all whitespace so `this.shared.appUrl` matches however it is wrapped. */
function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

export function normalizeTrust(options: UrlTrustOptions): UrlTrust {
  const originTexts = new Set<string>();
  const originCallees = new Set<string>();
  for (const entry of options.trustedOrigins ?? []) {
    const text = squash(entry);
    if (text.endsWith('()')) {
      originCallees.add(text.slice(0, -2));
    } else {
      originTexts.add(text);
    }
  }
  return {
    originTexts,
    originCallees,
    sanitizerCallees: new Set(
      (options.sanitizers ?? []).map((entry) => squash(entry).replace(/\(\)$/u, '')),
    ),
    pathTexts: new Set((options.trustedPaths ?? []).map(squash)),
  };
}

/** The URL expression a callee spec names, or undefined when there is none to check. */
export function urlArgumentOf(
  node: TSESTree.CallExpression,
  spec: UrlCalleeSpec,
): TSESTree.Expression | undefined {
  const index = spec.urlArgument ?? 0;
  const argument = index === 'last' ? node.arguments.at(-1) : node.arguments[index];
  if (argument === undefined || argument.type === AST_NODE_TYPES.SpreadElement) {
    return undefined;
  }
  if (argument.type !== AST_NODE_TYPES.ObjectExpression) {
    return argument;
  }
  const key = spec.urlProperty ?? DEFAULT_URL_PROPERTY;
  for (const property of argument.properties) {
    if (
      property.type === AST_NODE_TYPES.Property &&
      !property.computed &&
      ((property.key.type === AST_NODE_TYPES.Identifier && property.key.name === key) ||
        (property.key.type === AST_NODE_TYPES.Literal && property.key.value === key))
    ) {
      return property.value.type === AST_NODE_TYPES.AssignmentPattern ||
        property.value.type === AST_NODE_TYPES.ArrayPattern ||
        property.value.type === AST_NODE_TYPES.ObjectPattern ||
        property.value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression
        ? undefined
        : property.value;
    }
  }
  return undefined;
}

/** The first spec whose receiver and name match this call, else undefined. */
export function matchCallee(
  node: TSESTree.CallExpression,
  specs: readonly UrlCalleeSpec[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): UrlCalleeSpec | undefined {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return specs.find((spec) => spec.object === undefined && spec.name === callee.name);
  }
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return undefined;
  }
  const method = callee.property.name;
  const receiver = squash(sourceCode.getText(callee.object));
  return specs.find(
    (spec) => spec.object !== undefined && spec.name === method && squash(spec.object) === receiver,
  );
}

type Part =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'origin' }
  | { readonly kind: 'path' }
  | { readonly kind: 'unknown' };

const MAX_RESOLVE_DEPTH = 8;

/**
 * True when a URL expression's ORIGIN is fixed at author time, so no runtime
 * value can move the request (or the browser) to a different host.
 *
 * SSRF and open redirect are control of the *host*, not the path.
 * `fetch(`/api/todos/${id}`)` can only reach the current origin however hostile
 * `id` is, so requiring a plain literal would forbid the ordinary
 * resource-by-id call for no security gain.
 *
 * The expression is flattened into author-written text and runtime parts
 * (template quasis, `+` operands, `const` bindings resolved in-file), and what
 * decides it is the text before the first runtime part:
 *
 *   ok    `/api/todos/${id}`                 relative, same origin
 *   ok    `https://api.example.com/v${n}`    authority closed by `/` before `${}`
 *   ok    `${trustedOrigin}/x/${id}`          trusted origin, then `/`
 *   ok    `${trustedOrigin}${sanitize(p)}`    trusted origin, then a sanitized path
 *   FLAG  `${base}/api/todos`                the whole URL is runtime
 *   FLAG  `https://${host}/todos`            expression sits in the host position
 *   FLAG  `//${host}/todos`                  protocol-relative: host is still runtime
 *   FLAG  `/${p}`                            `p = "/evil.com"` makes it `//evil.com`
 *   FLAG  `https://api.example.com${p}`      authority not closed; `p` can start `@evil`
 *   FLAG  `${trustedOrigin}${p}`             the same userinfo trick after a trusted origin
 *
 * The userinfo trick is the subtle case: `https://api.example.com${p}` with
 * `p = "@evil.com/x"` resolves to host `evil.com`, because everything before an
 * `@` in the authority is userinfo. So the authority must be terminated by `/`,
 * `?` or `#` in author-written text (or by a configured sanitizer's path).
 */
export function hasFixedOrigin(
  node: TSESTree.Expression,
  trust: UrlTrust,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  const parts = mergeText(flatten(node, trust, sourceCode, 0, new Set()));
  const [head, ...rest] = parts;
  if (head === undefined) {
    // Only empty text: `''` is the current resource, which is same-origin.
    return true;
  }
  switch (head.kind) {
    case 'text':
      return rest.length === 0 || prefixPinsOrigin(head.value);
    case 'origin':
      return authorityClosedBy(rest, true);
    case 'path':
      return authorityClosedBy(rest, false);
    case 'unknown':
      return false;
  }
}

/**
 * After a trusted head, the next thing appended must not be able to extend the
 * authority. For an origin head that means text containing `/`, `?` or `#`, or
 * a sanitized path. For a path head any author text will do: the host is
 * already behind it; only a bare runtime value could turn `/` into `//`.
 */
function authorityClosedBy(rest: readonly Part[], originHead: boolean): boolean {
  for (const part of rest) {
    if (part.kind === 'text') {
      if (!originHead || /[/?#\\]/u.test(part.value)) {
        return true;
      }
      continue;
    }
    return originHead && part.kind === 'path';
  }
  return true;
}

/** Whether author-written text before the first runtime part fully determines the origin. */
function prefixPinsOrigin(rawPrefix: string): boolean {
  // Browsers (WHATWG URL) read `\` as `/` in special schemes, so `/\evil.com`
  // is protocol-relative. Analyse the prefix the way the browser will.
  const prefix = rawPrefix.replace(/\\/gu, '/');

  const scheme = /^[a-z][a-z0-9+.-]*:\/\//iu.exec(prefix);
  if (scheme === null && /^[a-z][a-z0-9+.-]*:/iu.test(prefix)) {
    // `https:${x}`: a scheme with no `//` yet, so `x` can supply `//evil.com`.
    return false;
  }
  const authorityStart = scheme === null ? (prefix.startsWith('//') ? 2 : -1) : scheme[0].length;

  if (authorityStart === -1) {
    // Relative URL. Safe, except a lone `/`: the runtime part can begin with
    // `/` and turn it into a protocol-relative `//evil.com`.
    return prefix !== '/';
  }

  // Absolute or protocol-relative: the authority must END inside the literal
  // text, otherwise the interpolation can extend or hijack the host.
  return /[/?#]/u.test(prefix.slice(authorityStart));
}

function mergeText(parts: readonly Part[]): Part[] {
  const merged: Part[] = [];
  for (const part of parts) {
    if (part.kind === 'text') {
      if (part.value === '') {
        continue;
      }
      const last = merged.at(-1);
      if (last?.kind === 'text') {
        merged[merged.length - 1] = { kind: 'text', value: last.value + part.value };
        continue;
      }
    }
    merged.push(part);
  }
  return merged;
}

function unwrap(node: TSESTree.Expression): TSESTree.Expression {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.AwaitExpression
  ) {
    current = current.type === AST_NODE_TYPES.AwaitExpression ? current.argument : current.expression;
  }
  return current;
}

/** A configured trusted role for this exact expression, matched by source text. */
function trustedRole(
  node: TSESTree.Expression,
  trust: UrlTrust,
  sourceCode: Readonly<TSESLint.SourceCode>,
): Part | undefined {
  const text = squash(sourceCode.getText(node));
  if (trust.originTexts.has(text)) {
    return { kind: 'origin' };
  }
  if (trust.pathTexts.has(text)) {
    return { kind: 'path' };
  }
  if (node.type === AST_NODE_TYPES.CallExpression) {
    const callee = squash(sourceCode.getText(node.callee));
    if (trust.originCallees.has(callee)) {
      return { kind: 'origin' };
    }
    if (trust.sanitizerCallees.has(callee)) {
      return { kind: 'path' };
    }
  }
  return undefined;
}

function flatten(
  raw: TSESTree.Expression,
  trust: UrlTrust,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth: number,
  seen: Set<TSESTree.Node>,
): Part[] {
  const node = unwrap(raw);
  const role = trustedRole(node, trust, sourceCode);
  if (role !== undefined) {
    return [role];
  }
  if (depth > MAX_RESOLVE_DEPTH) {
    return [{ kind: 'unknown' }];
  }
  const next = (child: TSESTree.Expression): Part[] =>
    flatten(child, trust, sourceCode, depth + 1, seen);

  switch (node.type) {
    case AST_NODE_TYPES.Literal:
      // Numbers and booleans stringify into the URL as plain author text.
      return node.value === null || node.value instanceof RegExp || typeof node.value === 'bigint'
        ? [{ kind: 'unknown' }]
        : [{ kind: 'text', value: String(node.value) }];

    case AST_NODE_TYPES.TemplateLiteral: {
      const parts: Part[] = [];
      node.quasis.forEach((quasi, index) => {
        parts.push({ kind: 'text', value: quasi.value.cooked ?? quasi.value.raw });
        const expression = node.expressions[index];
        if (expression !== undefined) {
          parts.push(...next(expression));
        }
      });
      return parts;
    }

    case AST_NODE_TYPES.BinaryExpression:
      if (node.operator === '+') {
        return [...next(node.left), ...next(node.right)];
      }
      return [{ kind: 'unknown' }];

    case AST_NODE_TYPES.Identifier:
      return resolveConst(node, sourceCode, seen, next);

    case AST_NODE_TYPES.NewExpression:
      return flattenNewUrl(node, next);

    case AST_NODE_TYPES.CallExpression:
      // `url.toString()` is the URL itself.
      if (
        node.arguments.length === 0 &&
        node.callee.type === AST_NODE_TYPES.MemberExpression &&
        !node.callee.computed &&
        node.callee.property.type === AST_NODE_TYPES.Identifier &&
        node.callee.property.name === 'toString'
      ) {
        return next(node.callee.object);
      }
      return [{ kind: 'unknown' }];

    case AST_NODE_TYPES.MemberExpression:
      // `url.href` is the URL itself.
      if (
        !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        node.property.name === 'href'
      ) {
        return next(node.object);
      }
      return [{ kind: 'unknown' }];

    default:
      return [{ kind: 'unknown' }];
  }
}

/** Sees through `const NAME = <expr>` declared in this file; anything else is runtime. */
function resolveConst(
  node: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
  seen: Set<TSESTree.Node>,
  next: (child: TSESTree.Expression) => Part[],
): Part[] {
  let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) {
      const def = variable.defs.at(0);
      if (
        variable.defs.length !== 1 ||
        def === undefined ||
        def.type !== 'Variable' ||
        def.parent.kind !== 'const' ||
        def.node.id.type !== AST_NODE_TYPES.Identifier ||
        def.node.init === null ||
        seen.has(def.node)
      ) {
        return [{ kind: 'unknown' }];
      }
      seen.add(def.node);
      const parts = next(def.node.init);
      seen.delete(def.node);
      return parts;
    }
    scope = scope.upper;
  }
  return [{ kind: 'unknown' }];
}

/**
 * `new URL(input, base?)`: an input with its own fixed origin decides it; a
 * relative input inherits the base's origin, so the base is what must be fixed.
 */
function flattenNewUrl(
  node: TSESTree.NewExpression,
  next: (child: TSESTree.Expression) => Part[],
): Part[] {
  if (node.callee.type !== AST_NODE_TYPES.Identifier || node.callee.name !== 'URL') {
    return [{ kind: 'unknown' }];
  }
  const [input, base] = node.arguments;
  if (input === undefined || input.type === AST_NODE_TYPES.SpreadElement) {
    return [{ kind: 'unknown' }];
  }
  const inputParts = mergeText(next(input));
  if (base === undefined) {
    return inputParts;
  }
  if (base.type === AST_NODE_TYPES.SpreadElement) {
    return [{ kind: 'unknown' }];
  }
  const head = inputParts[0];
  if (head?.kind === 'text') {
    const prefix = head.value.replace(/\\/gu, '/');
    const absolute = /^[a-z][a-z0-9+.-]*:/iu.test(prefix) || prefix.startsWith('//');
    if (absolute) {
      return inputParts;
    }
    // A relative input can only move the path; the origin is the base's.
    // Stand in a closed-authority marker so the base alone decides.
    return prefixPinsOrigin(prefix) || inputParts.length === 1
      ? [...mergeText(next(base)), { kind: 'text', value: '/' }]
      : [{ kind: 'unknown' }];
  }
  if (head?.kind === 'path') {
    return [...mergeText(next(base)), { kind: 'text', value: '/' }];
  }
  return [{ kind: 'unknown' }];
}
