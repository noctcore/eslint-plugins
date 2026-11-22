/*
 * Ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/runtime-boundaries/rules/no-user-controlled-fetch-url.ts.
 * Changed in the port: configurable `fetchCallees` (upstream hardcodes `fetch`
 * and `axios.get/post`), in-file `const` resolution, `+` concatenation,
 * `new URL(...)`, and the trusted-origin / sanitizer / trusted-path options.
 * Added here: Node's `http` / `https` clients, `axios.request(config)` and
 * `axios(config)` with the config followed through an in-file `const`, a
 * host check for `net` / `tls` sockets, and host-pinned URLs
 * (`new URL(url).hostname` checked against an allowlist first, see `../guards`).
 */
import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isHostPinned } from '../guards';
import {
  calleeSpecSchema,
  hasFixedOrigin,
  matchCallee,
  normalizeCallees,
  normalizeTrust,
  trustSchemaProperties,
  type UrlCalleeEntry,
  type UrlCalleeSpec,
  type UrlTrustOptions,
  urlArgumentOf,
} from '../url-origin';

const RULE_NAME = 'no-user-controlled-fetch-url';

export interface NoUserControlledFetchUrlOptions extends UrlTrustOptions {
  /**
   * Call shapes that issue an HTTP request: a string (`'http.fetchWithRetry'`)
   * or an object. Replaces the defaults when set. The same list works for
   * async-safety `require-fetch-timeout` and contracts `fetch-must-check-ok`.
   */
  readonly fetchCallees?: readonly UrlCalleeEntry[];
  /**
   * Calls that open a socket to a host: `net.connect(port, host)`,
   * `tls.connect({ host })`. The host must be fixed. Replaces the defaults.
   */
  readonly socketCallees?: readonly string[];
}

type RuleOptions = [NoUserControlledFetchUrlOptions];
type MessageIds = 'userControlledFetchUrl' | 'userControlledSocketHost';

const AXIOS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export const DEFAULT_FETCH_CALLEES: readonly UrlCalleeSpec[] = [
  { name: 'fetch' },
  ...AXIOS_METHODS.map((name) => ({ object: 'axios', name })),
  // `axios(config)`, `axios(url, config)` and `axios.request(config)`.
  { name: 'axios', urlProperty: 'url' },
  { object: 'axios', name: 'request', urlProperty: 'url' },
  // Node's clients: `http.get(url | options, ...)`; an options object's host is read below.
  { object: 'http', name: 'get' },
  { object: 'http', name: 'request' },
  { object: 'https', name: 'get' },
  { object: 'https', name: 'request' },
];

export const DEFAULT_SOCKET_CALLEES: readonly string[] = [
  'net.connect',
  'net.createConnection',
  'tls.connect',
];

/** Node client receivers whose options object names its target by `host` / `hostname`. */
const NODE_CLIENTS: ReadonlySet<string> = new Set(['http', 'https']);
const HOST_KEYS: ReadonlySet<string> = new Set(['host', 'hostname']);

/** An object literal, inline or the initializer of an in-file `const`. */
function objectLiteralOf(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.ObjectExpression | undefined {
  if (node.type === AST_NODE_TYPES.ObjectExpression) {
    return node;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return undefined;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  return variable?.defs.length === 1 &&
    def?.type === 'Variable' &&
    def.parent.kind === 'const' &&
    def.node.init?.type === AST_NODE_TYPES.ObjectExpression
    ? def.node.init
    : undefined;
}

/** The value of a named, non-computed property of an object literal. */
function propertyValue(
  object: TSESTree.ObjectExpression,
  keys: ReadonlySet<string>,
): TSESTree.Expression | undefined {
  for (const property of object.properties) {
    if (
      property.type === AST_NODE_TYPES.Property &&
      !property.computed &&
      ((property.key.type === AST_NODE_TYPES.Identifier && keys.has(property.key.name)) ||
        (property.key.type === AST_NODE_TYPES.Literal && keys.has(String(property.key.value))))
    ) {
      const value = property.value;
      return value.type === AST_NODE_TYPES.AssignmentPattern ||
        value.type === AST_NODE_TYPES.ArrayPattern ||
        value.type === AST_NODE_TYPES.ObjectPattern ||
        value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression
        ? undefined
        : value;
    }
  }
  return undefined;
}

/**
 * The expression a call sends its request to: the URL argument, read through
 * an in-file `const` object literal the way an inline one is read. For Node's
 * clients an options object names a host instead (`{ host, path }`), and that
 * host is returned with `kind: 'host'`.
 */
function requestTarget(
  node: TSESTree.CallExpression,
  spec: UrlCalleeSpec,
  sourceCode: Readonly<TSESLint.SourceCode>,
): { kind: 'url' | 'host'; node: TSESTree.Expression } | undefined {
  const index = spec.urlArgument ?? 0;
  const argument = index === 'last' ? node.arguments.at(-1) : node.arguments[index];
  if (argument === undefined || argument.type === AST_NODE_TYPES.SpreadElement) {
    return undefined;
  }
  const object = objectLiteralOf(argument, sourceCode);
  if (object === undefined) {
    const url = urlArgumentOf(node, spec);
    return url === undefined ? undefined : { kind: 'url', node: url };
  }
  if (spec.object !== undefined && NODE_CLIENTS.has(spec.object)) {
    const href = propertyValue(object, new Set([spec.urlProperty ?? 'href']));
    if (href !== undefined) {
      return { kind: 'url', node: href };
    }
    const host = propertyValue(object, HOST_KEYS);
    return host === undefined ? undefined : { kind: 'host', node: host };
  }
  const url = propertyValue(object, new Set([spec.urlProperty ?? 'href']));
  return url === undefined ? undefined : { kind: 'url', node: url };
}

/** True when a host expression is author-written: a literal, or a `const` bound to one. */
function isFixedHost(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string' || typeof node.value === 'number';
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    return node.expressions.every((expression) => isFixedHost(expression, sourceCode));
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  return (
    variable?.defs.length === 1 &&
    def?.type === 'Variable' &&
    def.parent.kind === 'const' &&
    def.node.id.type === AST_NODE_TYPES.Identifier &&
    def.node.init !== null &&
    isFixedHost(def.node.init, sourceCode)
  );
}

/**
 * The host a socket call connects to: `connect(port, host)`, `connect({ host })`.
 * `connect(path)` (a string first argument) is an IPC path, and no host
 * argument means localhost; both return undefined.
 */
function socketHost(
  node: TSESTree.CallExpression,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression | undefined {
  const [first, second] = node.arguments;
  if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) {
    return undefined;
  }
  const object = objectLiteralOf(first, sourceCode);
  if (object !== undefined) {
    return propertyValue(object, HOST_KEYS);
  }
  if (first.type === AST_NODE_TYPES.Literal && typeof first.value === 'string') {
    return undefined;
  }
  if (
    second === undefined ||
    second.type === AST_NODE_TYPES.SpreadElement ||
    second.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    second.type === AST_NODE_TYPES.FunctionExpression ||
    second.type === AST_NODE_TYPES.ObjectExpression
  ) {
    return undefined;
  }
  return second;
}

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fetchCallees: {
      type: 'array',
      items: calleeSpecSchema,
      description:
        'Call shapes that issue an HTTP request: a string such as `http.fetchWithRetry`, or an object with `name`, `object`, `urlArgument` and `urlProperty`. Replaces the defaults (`fetch`, `axios` and its methods, and `http` / `https` `get` and `request`).',
    },
    socketCallees: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Calls that open a socket to a host, as written (`net.connect`). The host argument must be fixed. Replaces the defaults (`net.connect`, `net.createConnection`, `tls.connect`).',
    },
    ...trustSchemaProperties,
  },
};

export const noUserControlledFetchUrlRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow HTTP requests whose origin is not fixed at authoring time: a runtime-controlled host enables SSRF.',
      cwe: ['CWE-918'],
      owasp: ['A10:2021'],
      securitySeverity: 8.6,
    },
    schema: [optionSchema],
    messages: {
      userControlledFetchUrl:
        'HTTP request URL `{{url}}` must have a fixed origin. Use a literal, or a template whose host is author-written and closed by `/`, `?` or `#` before the first `${...}`: `fetch(`/api/todos/${id}`)` is fine; `fetch(url)`, `fetch(`https://${host}/x`)` and `fetch(`https://api.example.com${path}`)` are not. A configured base URL goes in `trustedOrigins`.',
      userControlledSocketHost:
        'Socket host `{{host}}` must be fixed at authoring time: a runtime host lets the caller reach any machine the server can. Use a literal host, or check `new URL(url).hostname` against an allowlist before connecting.',
    },
  },
  defaultOptions: [
    {
      fetchCallees: DEFAULT_FETCH_CALLEES,
      socketCallees: DEFAULT_SOCKET_CALLEES,
      trustedOrigins: [],
      sanitizers: [],
      trustedPaths: [],
    },
  ],
  create(context, [options]) {
    const callees = normalizeCallees(options.fetchCallees ?? DEFAULT_FETCH_CALLEES);
    const sockets = normalizeCallees(options.socketCallees ?? DEFAULT_SOCKET_CALLEES);
    const trust = normalizeTrust(options);
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        if (matchCallee(node, sockets, sourceCode) !== undefined) {
          const host = socketHost(node, sourceCode);
          if (host !== undefined && !isFixedHost(host, sourceCode) && !isHostPinned(host, node, sourceCode)) {
            context.report({
              node: host,
              messageId: 'userControlledSocketHost',
              data: { host: sourceCode.getText(host) },
            });
          }
          return;
        }
        const spec = matchCallee(node, callees, sourceCode);
        if (spec === undefined) {
          return;
        }
        const target = requestTarget(node, spec, sourceCode);
        if (target === undefined) {
          return;
        }
        const fixed =
          target.kind === 'host'
            ? isFixedHost(target.node, sourceCode)
            : hasFixedOrigin(target.node, trust, sourceCode);
        if (fixed || isHostPinned(target.node, node, sourceCode)) {
          return;
        }
        context.report({
          node: target.node,
          messageId: target.kind === 'host' ? 'userControlledSocketHost' : 'userControlledFetchUrl',
          data: { url: sourceCode.getText(target.node), host: sourceCode.getText(target.node) },
        });
      },
    };
  },
});
