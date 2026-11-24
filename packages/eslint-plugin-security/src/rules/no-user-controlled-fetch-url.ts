/*
 * Ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/runtime-boundaries/rules/no-user-controlled-fetch-url.ts.
 * Changed in the port: configurable `fetchCallees` (upstream hardcodes `fetch`
 * and `axios.get/post`), in-file `const` resolution, `+` concatenation,
 * `new URL(...)`, and the trusted-origin / sanitizer / trusted-path options.
 * Added here: Node's `http` / `https` clients read the way Node picks the
 * target, axios configs and instances (`url`, `baseURL`, `socketPath`,
 * `proxy`), a target check for `net` / `tls` sockets, and host-pinned URLs
 * (`new URL(url).hostname` checked against an allowlist first, see `../guards`).
 */
import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isHostPinned } from '../guards';
import {
  isAuthorWritten,
  isChangedConstObject,
  isFixedValue,
  isFunctionValue,
  peelTypes,
  readOptions,
  type RequestOptions,
} from '../request-options';
import {
  calleeSpecSchema,
  hasFixedOrigin,
  isTrustedSource,
  matchCallee,
  normalizeCallees,
  normalizeTrust,
  sourceTrustSchemaProperties,
  trustSchemaProperties,
  type UrlCalleeEntry,
  type UrlCalleeSpec,
  type UrlTrust,
  type UrlTrustOptions,
  urlArgumentOf,
} from '../url-origin';
import { requestSourceOf, type TaintOptions } from '../request-taint';
import { callArguments, flowSteps, holdsAlongFlow, importedBinding, withArguments } from '../value-flow';

const RULE_NAME = 'no-user-controlled-fetch-url';

export interface NoUserControlledFetchUrlOptions extends UrlTrustOptions {
  /**
   * Call shapes that issue an HTTP request: a string (`'http.fetchWithRetry'`)
   * or an object. Replaces the defaults when set. The same list works for
   * async-safety `require-fetch-timeout` and contracts `fetch-must-check-ok`.
   */
  readonly fetchCallees?: readonly UrlCalleeEntry[];
  /**
   * Calls that open a socket: `net.connect(port, host)`, `tls.connect({ host })`.
   * The host, port and IPC path must be fixed. Replaces the defaults.
   */
  readonly socketCallees?: readonly string[];
}

type RuleOptions = [NoUserControlledFetchUrlOptions];
type MessageIds = 'userControlledFetchUrl' | 'userControlledSocketHost' | 'userControlledRequestOption';

const AXIOS_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'postForm',
  'putForm',
  'patchForm',
] as const;
/** axios methods that take a body before the config: `axios.post(url, data, config)`. */
const AXIOS_BODY_METHODS: ReadonlySet<string> = new Set(['post', 'put', 'patch', 'postForm', 'putForm', 'patchForm']);

export const DEFAULT_FETCH_CALLEES: readonly UrlCalleeSpec[] = [
  { name: 'fetch' },
  ...AXIOS_METHODS.map((name) => ({ object: 'axios', name })),
  // `axios(config)`, `axios(url, config)` and `axios.request(config)`.
  { name: 'axios', urlProperty: 'url' },
  { object: 'axios', name: 'request', urlProperty: 'url' },
  // Node's clients: `http.get(url | options, [options], ...)`, read below.
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

/**
 * Request-shaped input, for an options object the requester supplies whole
 * (`https.get(url, req.body)`): by name, or by its place in a handler.
 */
const REQUEST_TAINT: TaintOptions = {
  requestObjects: new Set(['req', 'request']),
  handlerRequests: true,
  context: 'path',
  sanitizers: new Set(),
};

/** Node client receivers, whose options object picks the target key by key. */
const NODE_CLIENTS: ReadonlySet<string> = new Set(['http', 'https']);

/** How each key of an options object can move the target, and the check it must pass. */
type KeyCheck = 'host' | 'url' | 'path' | 'fixed' | 'hook' | 'proxy';

/**
 * Every key of a Node `http` / `https` options object that picks where the
 * request goes. Node takes `hostname` over `host`, lets `socketPath` replace
 * both, falls back to `defaultPort` without a `port`, and hands `agent`,
 * `lookup` and `createConnection` the connection itself. `href` is not read on
 * a plain options object. A `path` that starts with `//` or holds a full URL
 * is sent as the request target, which a proxy follows.
 */
const NODE_KEYS: ReadonlyMap<string, KeyCheck> = new Map([
  ['hostname', 'host'],
  ['host', 'host'],
  ['port', 'fixed'],
  ['defaultPort', 'fixed'],
  ['protocol', 'fixed'],
  ['socketPath', 'fixed'],
  ['path', 'path'],
  ['agent', 'hook'],
  ['lookup', 'hook'],
  ['createConnection', 'hook'],
]);

/**
 * The keys of an axios config that pick the target: `url`, the `baseURL` a
 * relative `url` is joined to, Node's `socketPath`, a `proxy` the request is
 * sent through, and the agents and `lookup` that open the connection.
 */
const AXIOS_KEYS: ReadonlyMap<string, KeyCheck> = new Map([
  ['url', 'url'],
  ['baseURL', 'url'],
  ['socketPath', 'fixed'],
  ['proxy', 'proxy'],
  ['httpAgent', 'hook'],
  ['httpsAgent', 'hook'],
  ['lookup', 'hook'],
]);

/** The keys of an axios `proxy` object. */
const PROXY_KEYS: ReadonlyMap<string, KeyCheck> = new Map([
  ['host', 'host'],
  ['hostname', 'host'],
  ['port', 'fixed'],
  ['protocol', 'fixed'],
]);

/** The keys of `net.connect` / `tls.connect` options: the host, the port and an IPC `path`. */
const SOCKET_KEYS: ReadonlyMap<string, KeyCheck> = new Map([
  ['host', 'host'],
  ['hostname', 'host'],
  ['port', 'fixed'],
  ['path', 'fixed'],
  ['lookup', 'hook'],
]);

/** The axios call forms: where the URL and the config sit. */
type AxiosForm = 'call' | 'request' | 'create' | 'method' | 'body-method';

/** True for `axios` itself: the name, or the module's default export or namespace under another name. */
function namesAxios(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  if (node.name === 'axios') {
    return true;
  }
  const binding = importedBinding(node, sourceCode);
  return binding?.module === 'axios' && (binding.imported === 'default' || binding.imported === '*');
}

/**
 * True for `axios`, also behind a type wrapper or a binding that holds it
 * (`(axios as any)`, `const ax = axios`). Seeing more calls as axios only
 * adds checks, so the loose (taint) moves of `../value-flow` are followed.
 */
function isAxiosName(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  return flowSteps(node, node, sourceCode, 'taint').some((step) => namesAxios(peelTypes(step.node), sourceCode));
}

function isAxiosCreate(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    isAxiosName(node.object, sourceCode) &&
    node.property.type === AST_NODE_TYPES.Identifier &&
    node.property.name === 'create'
  );
}

/** True for a binding that holds `axios.create(...)` (`const api = axios.create(...)`, or an alias of it). */
function isAxiosInstance(raw: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (peelTypes(raw).type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  return flowSteps(raw, raw, sourceCode, 'taint').some((step) => {
    const node = peelTypes(step.node);
    return node.type === AST_NODE_TYPES.CallExpression && isAxiosCreate(node.callee, sourceCode);
  });
}

/** True for a call to the global `Object.assign`. */
function isObjectAssign(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): node is TSESTree.CallExpression {
  if (
    node.type !== AST_NODE_TYPES.CallExpression ||
    node.callee.type !== AST_NODE_TYPES.MemberExpression ||
    node.callee.computed ||
    node.callee.object.type !== AST_NODE_TYPES.Identifier ||
    node.callee.object.name !== 'Object' ||
    node.callee.property.type !== AST_NODE_TYPES.Identifier ||
    node.callee.property.name !== 'assign'
  ) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node.callee.object), node.callee.object);
  return variable === null || variable.defs.length === 0;
}

/** The static name of a member's property (`a.b`, `a['b']`), or null when it is computed at run time. */
function memberName(member: TSESTree.MemberExpression): string | null {
  if (!member.computed) {
    return member.property.type === AST_NODE_TYPES.Identifier ? member.property.name : null;
  }
  const property = member.property;
  if (property.type === AST_NODE_TYPES.Literal && typeof property.value === 'string') {
    return property.value;
  }
  return property.type === AST_NODE_TYPES.TemplateLiteral && property.expressions.length === 0
    ? (property.quasis[0]?.value.cooked ?? null)
    : null;
}

/** undici's clients, built on the origin they send every request to: `new Client(origin)`. */
const UNDICI_CLIENTS: ReadonlySet<string> = new Set(['Client', 'Pool']);

/** `new Request(input, ...)` (the global), or a `const` bound to one: the `input`. */
function requestInput(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression | null {
  let current = peelTypes(node);
  if (current.type === AST_NODE_TYPES.Identifier) {
    const variable = ASTUtils.findVariable(sourceCode.getScope(current), current);
    const def = variable?.defs[0];
    if (
      variable?.defs.length !== 1 ||
      def?.type !== 'Variable' ||
      def.parent.kind !== 'const' ||
      def.node.init === null
    ) {
      return null;
    }
    current = peelTypes(def.node.init);
  }
  if (
    current.type !== AST_NODE_TYPES.NewExpression ||
    current.callee.type !== AST_NODE_TYPES.Identifier ||
    current.callee.name !== 'Request'
  ) {
    return null;
  }
  const global = ASTUtils.findVariable(sourceCode.getScope(current), current.callee);
  const [input] = current.arguments;
  return (global === null || global.defs.length === 0) &&
    input !== undefined &&
    input.type !== AST_NODE_TYPES.SpreadElement
    ? input
    : null;
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
        'Calls that open a socket, as written (`net.connect`). The host, port and IPC path must be fixed. Replaces the defaults (`net.connect`, `net.createConnection`, `tls.connect`).',
    },
    ...trustSchemaProperties,
    ...sourceTrustSchemaProperties,
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
        'Request host `{{host}}` must be fixed at authoring time: a runtime host lets the caller reach any machine the server can. Use a literal host, or check `new URL(url).hostname` against an allowlist first.',
      userControlledRequestOption:
        'Request option `{{option}}` (`{{value}}`) must be fixed at authoring time: it can move the request to another host, port or socket. Use a literal or an in-file `const`, and spread only objects written in this file.',
    },
  },
  defaultOptions: [
    {
      fetchCallees: DEFAULT_FETCH_CALLEES,
      socketCallees: DEFAULT_SOCKET_CALLEES,
      trustedOrigins: [],
      sanitizers: [],
      trustedPaths: [],
      trustedSources: [],
      allowLoopback: false,
    },
  ],
  create(context, [options]) {
    const callees = normalizeCallees(options.fetchCallees ?? DEFAULT_FETCH_CALLEES);
    const sockets = normalizeCallees(options.socketCallees ?? DEFAULT_SOCKET_CALLEES);
    const trust: UrlTrust = normalizeTrust(options);
    const sourceCode = context.sourceCode;
    const axiosSpecs = callees.filter(
      (spec) => spec.object === 'axios' || (spec.object === undefined && spec.name === 'axios'),
    );

    /** The axios form of a call to `axios`, one of its methods, `axios.create` or an instance. */
    function axiosForm(node: TSESTree.CallExpression): AxiosForm | undefined {
      if (axiosSpecs.length === 0) {
        return undefined;
      }
      const callee = node.callee;
      if (isAxiosCreate(callee, sourceCode)) {
        return 'create';
      }
      let receiverIsAxios = false;
      let method: string | undefined;
      if (callee.type === AST_NODE_TYPES.Identifier) {
        receiverIsAxios = isAxiosName(callee, sourceCode) || isAxiosInstance(callee, sourceCode);
      } else if (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier
      ) {
        method = callee.property.name;
        receiverIsAxios =
          isAxiosName(callee.object, sourceCode) || isAxiosInstance(callee.object, sourceCode);
      }
      if (!receiverIsAxios) {
        return undefined;
      }
      const spec = axiosSpecs.find((candidate) =>
        method === undefined
          ? candidate.object === undefined
          : candidate.object !== undefined && candidate.name === method,
      );
      if (spec === undefined) {
        return undefined;
      }
      if (method === undefined) {
        return 'call';
      }
      if (method === 'request') {
        return 'request';
      }
      return AXIOS_BODY_METHODS.has(method) ? 'body-method' : 'method';
    }

    /** True for a call that only reads `argument`: a call this rule reads, or a source of `Object.assign`. */
    function readsOptions(call: TSESTree.CallExpression, argument: TSESTree.Node): boolean {
      return (
        matchCallee(call, sockets, sourceCode) !== undefined ||
        matchCallee(call, callees, sourceCode) !== undefined ||
        axiosForm(call) !== undefined ||
        (isObjectAssign(call, sourceCode) && call.arguments[0] !== argument)
      );
    }

    /** True for an options value the requester supplies: `req.body`, or a binding that holds it. */
    function isRequestControlled(node: TSESTree.Node, sink: TSESTree.Node): boolean {
      // A function is a callback, and a call result is a documented gap: the
      // rule does not judge what a helper returns.
      const settled = peelTypes(flowSteps(node, sink, sourceCode, 'taint').at(-1)?.node ?? node);
      return (
        !isFunctionValue(node, sourceCode) &&
        settled.type !== AST_NODE_TYPES.CallExpression &&
        settled.type !== AST_NODE_TYPES.NewExpression &&
        settled.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
        settled.type !== AST_NODE_TYPES.FunctionExpression &&
        requestSourceOf(node, sink, REQUEST_TAINT, sourceCode) !== null
      );
    }

    const read = (node: TSESTree.Node | undefined): RequestOptions | undefined =>
      node === undefined || node.type === AST_NODE_TYPES.SpreadElement
        ? undefined
        : readOptions(node, sourceCode, readsOptions);

    /**
     * Checks an options object that follows the URL. One the rule cannot see
     * (a parameter, a call result) is left alone. An in-file object changed
     * before the call, an `Object.assign` with a source the rule cannot read,
     * and an object the requester supplies (`req.body`) are reported, since
     * they may set any key. Each branch of `?:`, `||`, `&&` and `??` is
     * checked the same way.
     */
    function checkTrailing(
      node: TSESTree.Node | undefined,
      keys: ReadonlyMap<string, KeyCheck>,
      sink: TSESTree.Node,
    ): void {
      if (node === undefined || node.type === AST_NODE_TYPES.SpreadElement) {
        return;
      }
      const bare = peelTypes(node);
      if (bare.type === AST_NODE_TYPES.ConditionalExpression) {
        checkTrailing(bare.consequent, keys, sink);
        checkTrailing(bare.alternate, keys, sink);
        return;
      }
      if (bare.type === AST_NODE_TYPES.LogicalExpression) {
        checkTrailing(bare.left, keys, sink);
        checkTrailing(bare.right, keys, sink);
        return;
      }
      if (isObjectAssign(bare, sourceCode)) {
        checkAssigned(bare.arguments, keys, sink, 'options');
        return;
      }
      const found = read(node);
      if (found !== undefined) {
        checkOptions(found, keys, sink);
      } else if (isChangedConstObject(node, sourceCode, readsOptions) || isRequestControlled(node, sink)) {
        reportOption(node, 'options', node);
      }
    }

    /**
     * The objects `Object.assign` copies keys from, each read like an options
     * object. One the rule cannot read (a spread, a parameter, `req.body`) may
     * set any key, so it is reported.
     */
    function checkAssigned(
      args: readonly TSESTree.CallExpressionArgument[],
      keys: ReadonlyMap<string, KeyCheck>,
      sink: TSESTree.Node,
      option: string,
    ): void {
      for (const argument of args) {
        const found = read(argument);
        if (found !== undefined) {
          checkOptions(found, keys, sink);
        } else {
          reportOption(argument, option, argument);
        }
      }
    }

    /** True for `axios.defaults` or `api.defaults` on an axios instance. */
    function isAxiosDefaults(node: TSESTree.Node): boolean {
      const bare = peelTypes(node);
      return (
        axiosSpecs.length > 0 &&
        bare.type === AST_NODE_TYPES.MemberExpression &&
        memberName(bare) === 'defaults' &&
        (isAxiosName(bare.object, sourceCode) || isAxiosInstance(bare.object, sourceCode))
      );
    }

    function checkUrl(node: TSESTree.Expression, sink: TSESTree.Node): void {
      const target = requestInput(node, sourceCode) ?? node;
      if (
        hasFixedOrigin(target, trust, sourceCode) ||
        holdsAlongFlow(target, sink, sourceCode, (value, at) => isHostPinned(value, at, sourceCode))
      ) {
        return;
      }
      context.report({
        node: target,
        messageId: 'userControlledFetchUrl',
        data: { url: sourceCode.getText(target) },
      });
    }

    function checkHost(node: TSESTree.Node, sink: TSESTree.Node): void {
      if (
        isFixedValue(node, sourceCode) ||
        holdsAlongFlow(
          node,
          sink,
          sourceCode,
          (value, at) => isTrustedSource(value, trust, sourceCode) || isHostPinned(value, at, sourceCode),
        )
      ) {
        return;
      }
      context.report({
        node,
        messageId: 'userControlledSocketHost',
        data: { host: sourceCode.getText(node) },
      });
    }

    function reportOption(node: TSESTree.Node, option: string, value: TSESTree.Node): void {
      context.report({
        node,
        messageId: 'userControlledRequestOption',
        data: { option, value: sourceCode.getText(value) },
      });
    }

    function checkOption(
      name: string,
      check: KeyCheck,
      entry: { node: TSESTree.Node; value: TSESTree.Expression | null },
      sink: TSESTree.Node,
    ): void {
      const value = entry.value;
      if (value === null) {
        // A getter or method: the rule cannot tell what it returns.
        reportOption(entry.node, name, entry.node);
        return;
      }
      switch (check) {
        case 'host':
          checkHost(value, sink);
          return;
        case 'url':
          checkUrl(value, sink);
          return;
        case 'path':
          if (!hasFixedOrigin(value, trust, sourceCode)) {
            reportOption(value, name, value);
          }
          return;
        case 'fixed':
          if (!isFixedValue(value, sourceCode)) {
            reportOption(value, name, value);
          }
          return;
        case 'hook':
          if (!isAuthorWritten(value, sourceCode)) {
            reportOption(value, name, value);
          }
          return;
        case 'proxy': {
          const bare = peelTypes(value);
          if (bare.type === AST_NODE_TYPES.Literal && bare.value === false) {
            return;
          }
          const proxy = read(value);
          if (proxy === undefined) {
            reportOption(value, name, value);
            return;
          }
          checkOptions(proxy, PROXY_KEYS, sink);
          return;
        }
      }
    }

    /** Checks every target key of an options object; an opaque spread stands for the keys it may set. */
    function checkOptions(
      found: RequestOptions,
      keys: ReadonlyMap<string, KeyCheck>,
      sink: TSESTree.Node,
    ): void {
      let opaqueOpen = false;
      for (const [name, check] of keys) {
        const entry = found.entries.get(name);
        if (entry !== undefined) {
          checkOption(name, check, entry, sink);
        } else if (found.opaque !== null) {
          opaqueOpen = true;
        }
      }
      if (opaqueOpen && found.opaque !== null) {
        reportOption(found.opaque, '...', found.opaque);
      }
    }

    function checkSocket(node: TSESTree.CallExpression): void {
      const [first, second, ...rest] = callArguments(node.arguments, sourceCode);
      if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) {
        return;
      }
      const leading = read(first);
      let positionalHost = false;
      if (leading !== undefined) {
        checkOptions(leading, SOCKET_KEYS, node);
      } else {
        // `connect(port, host)` or `connect(path)`: a string literal is a fixed IPC path,
        // while a runtime value may be a port, a path or an options object.
        if (!isFixedValue(first, sourceCode) && !isFunctionValue(first, sourceCode)) {
          reportOption(first, 'port, path or options', first);
        }
        positionalHost =
          second !== undefined &&
          second.type !== AST_NODE_TYPES.SpreadElement &&
          peelTypes(second).type !== AST_NODE_TYPES.ObjectExpression &&
          !isFunctionValue(second, sourceCode) &&
          read(second) === undefined;
        if (positionalHost && second !== undefined) {
          checkHost(second, node);
        }
      }
      // `tls.connect(port, host, options)`: an options object overrides the positional host.
      for (const argument of [second, ...rest]) {
        if (argument === second && positionalHost && second !== undefined) {
          // Checked as a host above; a changed `const` object there is still reported.
          if (isChangedConstObject(second, sourceCode, readsOptions)) {
            reportOption(second, 'options', second);
          }
          continue;
        }
        checkTrailing(argument, SOCKET_KEYS, node);
      }
    }

    function checkNodeClient(node: TSESTree.CallExpression): void {
      const [first, second] = callArguments(node.arguments, sourceCode);
      if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) {
        return;
      }
      const leading = read(first);
      if (leading !== undefined) {
        // `http.get(options, callback)`: the options alone pick the target.
        checkOptions(leading, NODE_KEYS, node);
        return;
      }
      checkUrl(first, node);
      // `http.get(url, options)`: each options key overrides the same part of the URL.
      checkTrailing(second, NODE_KEYS, node);
    }

    function checkAxios(node: TSESTree.CallExpression, form: AxiosForm): void {
      const [first, second, third] = callArguments(node.arguments, sourceCode);
      const urlArgument = first?.type === AST_NODE_TYPES.SpreadElement ? undefined : first;
      if (form === 'create') {
        // The config is the only argument and every instance request starts from it,
        // so one the rule cannot read is reported, like a first-argument URL.
        if (first === undefined) {
          return;
        }
        const config = read(first);
        if (config === undefined) {
          reportOption(first, 'config', first);
          return;
        }
        checkOptions(config, AXIOS_KEYS, node);
        return;
      }
      if (form === 'call' || form === 'request') {
        const config = read(first);
        if (config !== undefined) {
          checkOptions(config, AXIOS_KEYS, node);
          return;
        }
        if (urlArgument !== undefined) {
          checkUrl(urlArgument, node);
        }
        if (form === 'call') {
          checkTrailing(second, AXIOS_KEYS, node);
        }
        return;
      }
      if (urlArgument !== undefined) {
        checkUrl(urlArgument, node);
      }
      checkTrailing(form === 'body-method' ? third : second, AXIOS_KEYS, node);
    }

    function checkOther(node: TSESTree.CallExpression, spec: UrlCalleeSpec): void {
      const index = spec.urlArgument ?? 0;
      const args = callArguments(node.arguments, sourceCode);
      const argument = index === 'last' ? args.at(-1) : args[index];
      const object = read(argument);
      if (object === undefined) {
        const url = urlArgumentOf(withArguments(node, sourceCode), spec);
        if (url !== undefined) {
          checkUrl(url, node);
        }
        return;
      }
      checkOptions(object, new Map([[spec.urlProperty ?? 'href', 'url']]), node);
    }

    return {
      // `new Client(origin)` and `new Pool(origin)` from undici send every request to `origin`.
      NewExpression(node: TSESTree.NewExpression): void {
        const callee = peelTypes(node.callee);
        const root = callee.type === AST_NODE_TYPES.MemberExpression ? peelTypes(callee.object) : callee;
        if (root.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        const binding = importedBinding(root, sourceCode);
        if (binding === null || binding.module !== 'undici') {
          return;
        }
        const name =
          callee.type === AST_NODE_TYPES.MemberExpression
            ? binding.imported === '*' || binding.imported === 'default'
              ? memberName(callee)
              : null
            : binding.imported;
        const [origin] = node.arguments;
        if (name === null || !UNDICI_CLIENTS.has(name) || origin === undefined || origin.type === AST_NODE_TYPES.SpreadElement) {
          return;
        }
        checkUrl(origin, node);
      },
      CallExpression(node: TSESTree.CallExpression): void {
        if (isObjectAssign(node, sourceCode)) {
          // `Object.assign(axios.defaults, { baseURL })` moves every request after it.
          const [target, ...sources] = node.arguments;
          if (target !== undefined && target.type !== AST_NODE_TYPES.SpreadElement && isAxiosDefaults(target)) {
            checkAssigned(sources, AXIOS_KEYS, node, 'defaults');
          }
          return;
        }
        if (matchCallee(node, sockets, sourceCode) !== undefined) {
          checkSocket(node);
          return;
        }
        const form = axiosForm(node);
        if (form !== undefined) {
          checkAxios(node, form);
          return;
        }
        const spec = matchCallee(node, callees, sourceCode);
        if (spec === undefined) {
          return;
        }
        if (spec.object !== undefined && NODE_CLIENTS.has(spec.object)) {
          checkNodeClient(node);
          return;
        }
        checkOther(node, spec);
      },
      // `axios.defaults.baseURL = x`, `axios.defaults['proxy'] = x` and `axios.defaults = config`
      // set the config every request after them starts from.
      AssignmentExpression(node: TSESTree.AssignmentExpression): void {
        const left = node.left;
        if (left.type !== AST_NODE_TYPES.MemberExpression) {
          return;
        }
        if (isAxiosDefaults(left)) {
          const config = read(node.right);
          if (config === undefined) {
            reportOption(node.right, 'defaults', node.right);
          } else {
            checkOptions(config, AXIOS_KEYS, node);
          }
          return;
        }
        if (!isAxiosDefaults(left.object)) {
          return;
        }
        const name = memberName(left);
        if (name === null) {
          // A key computed at run time may be `baseURL`.
          reportOption(left, 'defaults[...]', node.right);
          return;
        }
        const check = AXIOS_KEYS.get(name);
        if (check !== undefined) {
          checkOption(name, check, { node: left, value: node.right }, node);
        }
      },
    };
  },
});
