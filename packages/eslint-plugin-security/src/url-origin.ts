/*
 * Portions ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/boundary-utils.ts (`hasFixedOrigin`, `prefixPinsOrigin`).
 * Extended here with const resolution, `+` concatenation, `new URL(...)`, and the
 * configurable trusted-origin / sanitizer / trusted-path vocabulary.
 */
import {
  fetchCalleeEntrySchema,
  matchFetchCallee,
  normalizeFetchCallees,
  type FetchCalleeEntry,
  type FetchCalleeSpec,
} from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { conventionalCallee, flowStep, stringPieces } from './value-flow';

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
export type UrlCalleeSpec = FetchCalleeSpec;

/** A callee option entry: a string (`'axios.get'`) or a {@link UrlCalleeSpec}. */
export type UrlCalleeEntry = FetchCalleeEntry;

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
  /**
   * Variables whose value the person running the program picks, not a
   * requester (CLI and test code): the variable and every property read off
   * it (`config` covers `config.registryUrl` and `config.mirrors[0]`). Each
   * counts as a trusted origin, so what follows it must still close the
   * authority. The binding must be a variable or import that is never
   * written (also through an alias or a global object), never handed to a
   * call that may change it, and never takes request data; helpers are not
   * followed. Read by `no-user-controlled-fetch-url` only.
   */
  readonly trustedSources?: readonly string[];
  /**
   * Trust a URL whose author-written text names a loopback host
   * (`localhost`, `127.0.0.1`, `[::1]`) followed by a port the rule can see is
   * a number. Read by `no-user-controlled-fetch-url` only.
   */
  readonly allowLoopback?: boolean;
}

// The callee vocabulary is shared with the other plugins' fetch rules through
// @noctcore/eslint-utils, so one `fetchCallees` list works for all of them.
export const calleeSpecSchema: JSONSchema4 = fetchCalleeEntrySchema;

/** Normalise callee entries to their object form once per rule run. */
export const normalizeCallees: (entries: readonly UrlCalleeEntry[]) => UrlCalleeSpec[] = normalizeFetchCallees;

export const trustSchemaProperties: Record<string, JSONSchema4> = {
  trustedOrigins: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  sanitizers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  trustedPaths: { type: 'array', items: { type: 'string' }, uniqueItems: true },
};

export const sourceTrustSchemaProperties: Record<string, JSONSchema4> = {
  trustedSources: {
    type: 'array',
    items: { type: 'string' },
    uniqueItems: true,
    description:
      'For CLI and test code: variables whose value the person running the program picks (a CLI config or flag). The variable and every property read off it count as a trusted origin, unless the binding is a parameter, is written (also through an alias or a global object), is handed to a call that may change it, or takes request data. Helpers are not followed: handing the source to one ends the trust.',
  },
  allowLoopback: {
    type: 'boolean',
    description:
      'Trust a URL whose author-written text names `localhost`, `127.0.0.1` or `[::1]` followed by a port that is a number literal or a numeric expression (`Number(port)`).',
  },
};

/** Normalized, lookup-ready form of {@link UrlTrustOptions}. */
export interface UrlTrust {
  readonly originTexts: ReadonlySet<string>;
  readonly originCallees: ReadonlySet<string>;
  readonly sanitizerCallees: ReadonlySet<string>;
  readonly pathTexts: ReadonlySet<string>;
  readonly sourceTexts: ReadonlySet<string>;
  readonly loopback: boolean;
  /**
   * True when the root binding of a trusted source may hold request data
   * (`const config = req.body`). Set by a rule that follows request taint;
   * without it, no source binding is taken to reach a request.
   */
  readonly sourceReachesRequest?: (root: TSESTree.Identifier) => boolean;
  /**
   * True for a call that only reads its arguments, such as one of the rule's
   * own request calls: a trusted source handed to it stays trusted. Any other
   * call a source is handed to, besides a few known readers (`String`,
   * `new URL`, `JSON.stringify`), may change it.
   */
  readonly readsSource?: (call: TSESTree.CallExpression | TSESTree.NewExpression) => boolean;
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
    sourceTexts: new Set((options.trustedSources ?? []).map(squash)),
    loopback: options.allowLoopback === true,
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
  const direct = matchFetchCallee(node, specs, sourceCode);
  if (direct !== undefined) {
    return direct;
  }
  // An import bound to another name: `client.get` for `import * as client from 'node:https'`.
  const text = conventionalCallee(node.callee, sourceCode);
  if (text === null) {
    return undefined;
  }
  const dot = text.lastIndexOf('.');
  const name = text.slice(dot + 1);
  const object = dot === -1 ? undefined : text.slice(0, dot);
  return specs.find(
    (spec) =>
      spec.name === name &&
      (spec.object === undefined ? object === undefined : object !== undefined && squash(spec.object) === object),
  );
}

type Part =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'origin' }
  | { readonly kind: 'path' }
  | { readonly kind: 'number' }
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
      return rest.length === 0 || prefixPinsOrigin(head.value) || (trust.loopback && loopbackWithPort(head.value, rest));
    case 'origin':
      return authorityClosedBy(rest, true);
    case 'path':
      return authorityClosedBy(rest, false);
    case 'number':
    case 'unknown':
      return false;
  }
}

/**
 * `http://127.0.0.1:${port}/x`: a loopback host written in full, then a port
 * that is a number, then nothing or text that closes the authority. Every
 * string a number turns into (`3000`, `-1`, `NaN`, `1e+21`) is a port or an
 * invalid URL, never `@` or `/`, so the host cannot move. Anything else
 * after the port could start `@evil.com` and turn the host into userinfo.
 */
function loopbackWithPort(rawPrefix: string, rest: readonly Part[]): boolean {
  const prefix = rawPrefix
    .replace(/^[\u0000- ]+/u, '')
    .replace(/[\t\n\r]/gu, '')
    .replace(/\\/gu, '/');
  const [port, after] = rest;
  return (
    /^(?:https?|wss?):\/\/(?:localhost|127\.0\.0\.1|\[::1\]):$/iu.test(prefix) &&
    port?.kind === 'number' &&
    (after === undefined || (after.kind === 'text' && /^[/?#\\]/u.test(after.value)))
  );
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

/**
 * Schemes that leave the page's origin, reach the file system or run script
 * when a redirect or a request is sent to them. A relative prefix that can
 * still grow into one of them (`h`, `java`, `dat`) does not pin the origin.
 */
const ORIGIN_MOVING_SCHEMES: readonly string[] = [
  'http',
  'https',
  'ws',
  'wss',
  'ftp',
  'ftps',
  'sftp',
  'file',
  'data',
  'blob',
  'filesystem',
  'javascript',
  'vbscript',
  'livescript',
  'view-source',
  'jar',
  'intent',
  'gopher',
  'ldap',
  'ldaps',
  'dict',
  'tftp',
  'telnet',
  'smb',
];

/**
 * True when relative text made only of scheme characters can still become one
 * of {@link ORIGIN_MOVING_SCHEMES} once the runtime part after it supplies the
 * rest and a `:` (`h` then `ttps://evil.com`). Text no such scheme starts
 * with (`page`, `users`, `api`) can only become a scheme the browser and
 * `fetch` do not follow, or a path.
 */
function canStartOriginMovingScheme(prefix: string): boolean {
  const lower = prefix.toLowerCase();
  return (
    /^[a-z][a-z0-9+.-]*$/u.test(lower) &&
    ORIGIN_MOVING_SCHEMES.some((scheme) => scheme.startsWith(lower))
  );
}

/** Whether author-written text before the first runtime part fully determines the origin. */
function prefixPinsOrigin(rawPrefix: string): boolean {
  // Analyse the prefix the way the browser (WHATWG URL) will: leading spaces
  // and control characters are dropped, a tab or line break is dropped from
  // anywhere (`/<tab>` is a lone `/`), and `\` reads as `/` in special
  // schemes, so `/\evil.com` is protocol-relative.
  const prefix = rawPrefix
    .replace(/^[\u0000- ]+/u, '')
    .replace(/[\t\n\r]/gu, '')
    .replace(/\\/gu, '/');

  const scheme = /^[a-z][a-z0-9+.-]*:\/\/+/iu.exec(prefix);
  if (scheme === null && /^[a-z][a-z0-9+.-]*:/iu.test(prefix)) {
    // `https:${x}`: a scheme with no `//` yet, so `x` can supply `//evil.com`.
    return false;
  }
  // Every `/` after `https:` or a leading `//` still opens the authority
  // (`https:///` then `evil.com` goes to evil.com), so the host starts after them.
  const leadingSlashes = /^\/\/+/u.exec(prefix);
  const authorityStart =
    scheme === null ? (leadingSlashes === null ? -1 : leadingSlashes[0].length) : scheme[0].length;

  if (authorityStart === -1) {
    // Relative URL. Safe, except a lone `/` (the runtime part can begin with
    // `/` and turn it into a protocol-relative `//evil.com`) or nothing left
    // once the parser drops what it drops (`' '` then the whole URL), or text
    // the runtime part can finish into a scheme that moves the origin
    // (`h` then `ttps://evil.com`, `java` then `script:alert(1)`).
    return prefix !== '/' && prefix !== '' && !canStartOriginMovingScheme(prefix);
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
  if (trust.originTexts.has(text) || readsTrustedSource(node, trust, sourceCode)) {
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

/** True for a configured trusted source or a property read off one (see {@link UrlTrustOptions.trustedSources}). */
export function isTrustedSource(
  node: TSESTree.Node,
  trust: UrlTrust,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  return isExpression(node) && readsTrustedSource(unwrap(node), trust, sourceCode);
}

function isExpression(node: TSESTree.Node): node is TSESTree.Expression {
  return node.type !== AST_NODE_TYPES.SpreadElement && node.type !== AST_NODE_TYPES.PrivateIdentifier;
}

/**
 * A configured trusted source, or a property read off one by name or literal
 * key. A key computed at run time could pick a value the entry does not
 * cover (`config[req.query.k]`), so it does not count.
 */
function readsTrustedSource(
  node: TSESTree.Expression,
  trust: UrlTrust,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  if (trust.sourceTexts.size === 0) {
    return false;
  }
  let current: TSESTree.Expression = node;
  for (;;) {
    if (current.type === AST_NODE_TYPES.ChainExpression) {
      current = current.expression;
    }
    if (trust.sourceTexts.has(squash(sourceCode.getText(current)))) {
      return isSettledSource(current, trust, sourceCode);
    }
    if (
      current.type !== AST_NODE_TYPES.MemberExpression ||
      (current.computed && current.property.type !== AST_NODE_TYPES.Literal)
    ) {
      return false;
    }
    current = unwrap(current.object);
  }
}

/**
 * True when the binding a trusted source is read from holds what the person
 * running the program picked, and nothing can swap it for request data: its
 * root is a variable or import (not a parameter, which any caller fills, nor
 * `this` or a call result), it is never reassigned, nothing under it is
 * written, it never takes its value from a request, and it never leaves the
 * reach of this check (see {@link letsGo}). For an undeclared global, a write
 * through `globalThis`, `global`, `window` or `self` counts as a write.
 */
function isSettledSource(
  source: TSESTree.Expression,
  trust: UrlTrust,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  let root: TSESTree.Expression = source;
  for (;;) {
    if (root.type === AST_NODE_TYPES.ChainExpression) {
      root = root.expression;
    } else if (root.type === AST_NODE_TYPES.MemberExpression) {
      root = unwrap(root.object);
    } else {
      break;
    }
  }
  if (root.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(root), root);
  let references: readonly TSESLint.Scope.Reference[];
  const starts: TSESTree.Node[] = [];
  if (variable === null || variable.defs.length === 0) {
    const name = root.name;
    const through = sourceCode.scopeManager?.globalScope?.through ?? [];
    references = variable?.references ?? through.filter((ref) => ref.identifier.name === name);
    starts.push(...globalPropertyReads(name, sourceCode));
  } else {
    const def = variable.defs[0];
    if (variable.defs.length !== 1 || (def?.type !== 'Variable' && def?.type !== 'ImportBinding')) {
      return false;
    }
    references = variable.references;
  }
  if (references.some((reference) => reference.init !== true && reference.isWrite())) {
    return false;
  }
  const walk: SourceWalk = { trust, sourceCode, seen: new Set(variable === null ? [] : [variable]) };
  return (
    !references.some((reference) => reference.init !== true && letsGo(reference.identifier, walk, false)) &&
    !starts.some((start) => letsGo(start, walk, true)) &&
    !(trust.sourceReachesRequest?.(root) ?? false)
  );
}

interface SourceWalk {
  readonly trust: UrlTrust;
  readonly sourceCode: Readonly<TSESLint.SourceCode>;
  /** Bindings already followed, so a cycle of aliases ends. */
  readonly seen: Set<TSESLint.Scope.Variable>;
}

/** Objects an undeclared global is also a property of. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'global', 'window', 'self']);

/** `globalThis.config` and `window['config']` for an undeclared global `config`. */
function globalPropertyReads(name: string, sourceCode: Readonly<TSESLint.SourceCode>): TSESTree.Node[] {
  const globalScope = sourceCode.scopeManager?.globalScope;
  if (globalScope == null) {
    return [];
  }
  const references = [
    ...globalScope.through,
    ...[...GLOBAL_OBJECTS].flatMap((object) => globalScope.set.get(object)?.references ?? []),
  ];
  return references.flatMap((reference) => {
    const parent = reference.identifier.parent;
    return GLOBAL_OBJECTS.has(reference.identifier.name) &&
      parent?.type === AST_NODE_TYPES.MemberExpression &&
      parent.object === reference.identifier &&
      memberKey(parent) === name
      ? [parent]
      : [];
  });
}

function memberKey(member: TSESTree.MemberExpression): string | undefined {
  if (!member.computed && member.property.type === AST_NODE_TYPES.Identifier) {
    return member.property.name;
  }
  return member.property.type === AST_NODE_TYPES.Literal && typeof member.property.value === 'string'
    ? member.property.value
    : undefined;
}

/** Methods that change the array, map or set they are called on. */
const MUTATING_METHODS = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

/**
 * Methods whose result is a new string, number or boolean, never an object
 * held under the receiver: what is done with the result cannot change the
 * source. The result of any other method (`at`, `find`, `get`, `values`)
 * may be a nested object, so it is followed like the source itself.
 */
const DETACHED_RESULT_METHODS: ReadonlySet<string> = new Set([
  'replace',
  'replaceAll',
  'slice',
  'substring',
  'substr',
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toString',
  'toFixed',
  'startsWith',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'padStart',
  'padEnd',
  'charAt',
  'charCodeAt',
  'split',
  'join',
  'match',
  'test',
  'has',
  'normalize',
  'repeat',
]);

/** Global functions that only read their arguments, matched when not shadowed. */
const READING_FUNCTIONS: ReadonlySet<string> = new Set([
  'String',
  'Number',
  'Boolean',
  'BigInt',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'encodeURI',
  'decodeURIComponent',
  'decodeURI',
  'URL',
  'URLSearchParams',
]);

/** Static methods of globals that only read their arguments, matched when not shadowed. */
const READING_METHODS: Readonly<Record<string, ReadonlySet<string> | 'any'>> = {
  Object: new Set(['keys', 'values', 'entries', 'freeze', 'isFrozen', 'getOwnPropertyNames', 'hasOwn']),
  JSON: new Set(['stringify']),
  Array: new Set(['isArray']),
  Number: new Set(['isInteger', 'isFinite', 'isNaN', 'parseInt', 'parseFloat']),
  console: 'any',
  Math: 'any',
};

/**
 * True when a reference lets the source go where this check cannot follow
 * it, or changes it. Writes: a write under it (`config.url = x`,
 * `delete config.url`, `({ url: config.url } = x)`, `config.mirrors.push(x)`)
 * and, with `writeCounts`, a write of the start itself (`globalThis.config = x`).
 * Leaving: being handed to any call that does not only read it
 * (`merge(config, x)`, `Object.assign({}, config)`, `_.set(config, ...)`),
 * thrown, returned or stored in something other than a local binding. A copy
 * into a local binding (`const c = config`, `const { mirrors } = config`,
 * `for (const m of config.mirrors)`, a callback parameter of
 * `config.mirrors.forEach(...)`) is followed: every reference to it is checked
 * the same way.
 */
function letsGo(start: TSESTree.Node, walk: SourceWalk, writeCounts: boolean): boolean {
  let chain: TSESTree.Node = start;
  for (;;) {
    const parent: TSESTree.Node | undefined = chain.parent;
    if (
      (parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === chain) ||
      isTransparent(parent)
    ) {
      chain = parent!;
    } else {
      break;
    }
  }
  const parent = chain.parent;
  if (parent === undefined) {
    return false;
  }
  if (isWriteTarget(chain, parent)) {
    return chain !== start || writeCounts;
  }
  const last = unwrapChain(chain);
  if (
    parent.type === AST_NODE_TYPES.CallExpression &&
    parent.callee === chain &&
    last.type === AST_NODE_TYPES.MemberExpression
  ) {
    return methodLetsGo(parent, last, walk);
  }
  return valueLetsGo(chain, walk);
}

function isTransparent(node: TSESTree.Node | undefined): node is TSESTree.Node {
  return (
    node?.type === AST_NODE_TYPES.ChainExpression ||
    node?.type === AST_NODE_TYPES.TSNonNullExpression ||
    node?.type === AST_NODE_TYPES.TSAsExpression ||
    node?.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    node?.type === AST_NODE_TYPES.TSTypeAssertion
  );
}

/** True when `node` is where a value is stored, not read. */
function isWriteTarget(node: TSESTree.Node, parent: TSESTree.Node): boolean {
  return (
    (parent.type === AST_NODE_TYPES.AssignmentExpression && parent.left === node) ||
    parent.type === AST_NODE_TYPES.UpdateExpression ||
    (parent.type === AST_NODE_TYPES.UnaryExpression && parent.operator === 'delete') ||
    ((parent.type === AST_NODE_TYPES.ForInStatement || parent.type === AST_NODE_TYPES.ForOfStatement) &&
      parent.left === node) ||
    parent.type === AST_NODE_TYPES.ArrayPattern ||
    parent.type === AST_NODE_TYPES.RestElement ||
    (parent.type === AST_NODE_TYPES.AssignmentPattern && parent.left === node) ||
    (parent.type === AST_NODE_TYPES.Property &&
      parent.value === node &&
      parent.parent.type === AST_NODE_TYPES.ObjectPattern)
  );
}

/**
 * A method called on the source or on something under it: a mutating one
 * changes it; an inline callback's parameters receive its elements and are
 * followed; a result that may be a nested object is followed too.
 */
function methodLetsGo(
  call: TSESTree.CallExpression,
  callee: TSESTree.MemberExpression,
  walk: SourceWalk,
): boolean {
  const name = memberKey(callee);
  if (name === undefined || MUTATING_METHODS.has(name)) {
    return true;
  }
  for (const argument of call.arguments) {
    if (
      (argument.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        argument.type === AST_NODE_TYPES.FunctionExpression) &&
      walk.sourceCode.getDeclaredVariables(argument).some((variable) => aliasLetsGo(variable, walk))
    ) {
      return true;
    }
  }
  return !DETACHED_RESULT_METHODS.has(name) && valueLetsGo(call, walk);
}

/**
 * Where the value of `node` (the source, or something holding it) goes. It
 * stays when it is only read: string building, comparisons, tests, a key, a
 * reading call. A copy into a local binding is followed. Anything else lets
 * it go.
 */
function valueLetsGo(node: TSESTree.Node, walk: SourceWalk): boolean {
  const parent = node.parent;
  if (parent === undefined) {
    return true;
  }
  switch (parent.type) {
    case AST_NODE_TYPES.ChainExpression:
    case AST_NODE_TYPES.TSNonNullExpression:
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
    case AST_NODE_TYPES.TSTypeAssertion:
    case AST_NODE_TYPES.AwaitExpression:
    case AST_NODE_TYPES.ArrayExpression:
    case AST_NODE_TYPES.ObjectExpression:
      return valueLetsGo(parent, walk);
    case AST_NODE_TYPES.MemberExpression:
      // A member of what holds the source may be the source or part of it, so
      // a write to it counts; a computed key is only read.
      return parent.object === node ? letsGo(parent, walk, true) : false;
    case AST_NODE_TYPES.Property:
      return parent.value === node && parent.parent.type === AST_NODE_TYPES.ObjectExpression
        ? valueLetsGo(parent, walk)
        : false;
    case AST_NODE_TYPES.SpreadElement:
      return parent.parent.type === AST_NODE_TYPES.CallExpression || parent.parent.type === AST_NODE_TYPES.NewExpression
        ? !onlyReads(parent.parent, walk)
        : valueLetsGo(parent, walk);
    case AST_NODE_TYPES.LogicalExpression:
      return valueLetsGo(parent, walk);
    case AST_NODE_TYPES.ConditionalExpression:
      return parent.test === node ? false : valueLetsGo(parent, walk);
    case AST_NODE_TYPES.SequenceExpression:
      return parent.expressions.at(-1) === node ? valueLetsGo(parent, walk) : false;
    case AST_NODE_TYPES.TemplateLiteral:
      return parent.parent.type === AST_NODE_TYPES.TaggedTemplateExpression;
    case AST_NODE_TYPES.TaggedTemplateExpression:
    case AST_NODE_TYPES.BinaryExpression:
    case AST_NODE_TYPES.UnaryExpression:
    case AST_NODE_TYPES.ExpressionStatement:
    case AST_NODE_TYPES.IfStatement:
    case AST_NODE_TYPES.WhileStatement:
    case AST_NODE_TYPES.DoWhileStatement:
    case AST_NODE_TYPES.ForStatement:
    case AST_NODE_TYPES.ForInStatement:
    case AST_NODE_TYPES.SwitchStatement:
    case AST_NODE_TYPES.SwitchCase:
    case AST_NODE_TYPES.ExportSpecifier:
      return false;
    case AST_NODE_TYPES.CallExpression:
    case AST_NODE_TYPES.NewExpression:
      return parent.callee === node ? false : !onlyReads(parent, walk);
    case AST_NODE_TYPES.VariableDeclarator:
      return parent.init === node && copyLetsGo(parent, walk);
    case AST_NODE_TYPES.ForOfStatement:
      return parent.right === node && copyLetsGo(parent.left, walk);
    case AST_NODE_TYPES.AssignmentExpression:
      if (parent.right !== node) {
        return true;
      }
      if (!['=', '||=', '&&=', '??='].includes(parent.operator)) {
        return false;
      }
      return parent.left.type !== AST_NODE_TYPES.Identifier || copyLetsGo(parent.left, walk);
    default:
      return true;
  }
}

/** Follows every local binding a copy lands in (`const c = config`, `const { a, ...rest } = config`). */
function copyLetsGo(target: TSESTree.Node, walk: SourceWalk): boolean {
  if (target.type === AST_NODE_TYPES.Identifier) {
    const variable = ASTUtils.findVariable(walk.sourceCode.getScope(target), target);
    return variable === null || variable.defs.length === 0 || aliasLetsGo(variable, walk);
  }
  if (target.type !== AST_NODE_TYPES.VariableDeclarator && target.type !== AST_NODE_TYPES.VariableDeclaration) {
    // A pattern assigned outside a declaration: `for ({ url } of config.mirrors)`.
    return true;
  }
  const declaration = target.type === AST_NODE_TYPES.VariableDeclarator ? target.parent : target;
  if (declaration.parent.type === AST_NODE_TYPES.ExportNamedDeclaration) {
    // Another module can write the copy.
    return true;
  }
  const variables = walk.sourceCode.getDeclaredVariables(target);
  return variables.length === 0 || variables.some((variable) => aliasLetsGo(variable, walk));
}

/** True when a binding holding (part of) the source lets it go through any reference. */
function aliasLetsGo(variable: TSESLint.Scope.Variable, walk: SourceWalk): boolean {
  if (walk.seen.has(variable)) {
    return false;
  }
  walk.seen.add(variable);
  return variable.references.some(
    (reference) => !(reference.isWrite() && !reference.isRead()) && letsGo(reference.identifier, walk, false),
  );
}

/** True for a call that only reads its arguments: one the rule itself reads, or a known reader. */
function onlyReads(call: TSESTree.CallExpression | TSESTree.NewExpression, walk: SourceWalk): boolean {
  if (walk.trust.readsSource?.(call) === true) {
    return true;
  }
  const callee = unwrapChain(call.callee);
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return READING_FUNCTIONS.has(callee.name) && isUnshadowedGlobal(callee, walk);
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.object.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const methods = READING_METHODS[callee.object.name];
  const name = memberKey(callee);
  return (
    methods !== undefined &&
    name !== undefined &&
    (methods === 'any' || methods.has(name)) &&
    isUnshadowedGlobal(callee.object, walk)
  );
}

function isUnshadowedGlobal(identifier: TSESTree.Identifier, walk: SourceWalk): boolean {
  const variable = ASTUtils.findVariable(walk.sourceCode.getScope(identifier), identifier);
  return variable === null || variable.defs.length === 0;
}
function unwrapChain(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.ChainExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion
  ) {
    current = current.expression;
  }
  return current;
}

/** Globals whose result is always a number. */
const NUMBER_CALLS = new Set(['Number', 'parseInt', 'parseFloat']);
/** `Math` methods that always return a number (`Math.constructor(x)` returns `x`). */
const MATH_NUMBER_METHODS = new Set(['max', 'min', 'floor', 'trunc', 'round', 'abs', 'ceil']);
const NUMBER_OPERATORS = new Set(['-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>']);

/** True for an unshadowed global name read here. */
function isGlobal(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): node is TSESTree.Identifier {
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  return variable === null || variable.defs.length === 0;
}

/**
 * Expressions whose value is a number whatever their operands hold:
 * `Number(x)`, `parseInt(x)`, `Number.parseInt(x)`, `Math.max(...)`, `+x`,
 * `a - b`. A `+` between two values may join strings, so it does not count.
 */
function isNumberExpression(node: TSESTree.Expression, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (node.type === AST_NODE_TYPES.UnaryExpression) {
    return node.operator === '+' || node.operator === '-' || node.operator === '~';
  }
  if (node.type === AST_NODE_TYPES.BinaryExpression) {
    return NUMBER_OPERATORS.has(node.operator);
  }
  if (node.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return NUMBER_CALLS.has(callee.name) && isGlobal(callee, sourceCode);
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    isGlobal(callee.object, sourceCode) &&
    ((callee.object.name === 'Math' && MATH_NUMBER_METHODS.has(callee.property.name)) ||
      (callee.object.name === 'Number' &&
        (callee.property.name === 'parseInt' || callee.property.name === 'parseFloat')))
  );
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
  if (isNumberExpression(node, sourceCode)) {
    return [{ kind: 'number' }];
  }
  const parts = flattenNode(node, sourceCode, seen, next);
  if (parts.length !== 1 || parts[0]?.kind !== 'unknown') {
    return parts;
  }
  // The value it holds exactly: a helper's argument, an object property or
  // array element, a callback's value (`./value-flow`).
  const step = flowStep(node, node, sourceCode);
  return step === null || seen.has(step.node) ? parts : next(step.node as TSESTree.Expression);
}

function flattenNode(
  node: TSESTree.Expression,
  sourceCode: Readonly<TSESLint.SourceCode>,
  seen: Set<TSESTree.Node>,
  next: (child: TSESTree.Expression) => Part[],
): Part[] {
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
      // `'https://api.example.com/'.concat(path)`, `[base, '/', path].join('')`.
      return (
        stringPieces(node, sourceCode)?.flatMap((piece): Part[] =>
          typeof piece === 'string' ? [{ kind: 'text', value: piece }] : next(piece),
        ) ?? [{ kind: 'unknown' }]
      );

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
