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
import { callArguments, holdsAlongFlow, importedBinding, withArguments } from '../value-flow';

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

const AXIOS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;
/** axios methods that take a body before the config: `axios.post(url, data, config)`. */
const AXIOS_BODY_METHODS: ReadonlySet<string> = new Set(['post', 'put', 'patch']);

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
function isAxiosName(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  if (node.name === 'axios') {
    return true;
  }
  const binding = importedBinding(node, sourceCode);
  return binding?.module === 'axios' && (binding.imported === 'default' || binding.imported === '*');
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

/** True for a `const api = axios.create(...)` binding read here. */
function isAxiosInstance(raw: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const node = peelTypes(raw);
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  const init = def?.type === 'Variable' && def.node.init !== null ? peelTypes(def.node.init) : null;
  return (
    variable?.defs.length === 1 &&
    def?.type === 'Variable' &&
    def.parent.kind === 'const' &&
    init?.type === AST_NODE_TYPES.CallExpression &&
    isAxiosCreate(init.callee, sourceCode)
  );
}

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

    /** True for a call this rule reads an options object of: it does not change the object. */
    function readsOptions(call: TSESTree.CallExpression): boolean {
      return (
        matchCallee(call, sockets, sourceCode) !== undefined ||
        matchCallee(call, callees, sourceCode) !== undefined ||
        axiosForm(call) !== undefined
      );
    }

    const read = (node: TSESTree.Node | undefined): RequestOptions | undefined =>
      node === undefined || node.type === AST_NODE_TYPES.SpreadElement
        ? undefined
        : readOptions(node, sourceCode, readsOptions);

    /**
     * Checks an options object that follows the URL. One the rule cannot see
     * (a parameter) is left alone; an in-file object changed before the call
     * is reported, since the change may set any key.
     */
    function checkTrailing(
      node: TSESTree.Node | undefined,
      keys: ReadonlyMap<string, KeyCheck>,
      sink: TSESTree.Node,
    ): void {
      const found = read(node);
      if (found !== undefined) {
        checkOptions(found, keys, sink);
      } else if (node !== undefined && isChangedConstObject(node, sourceCode, readsOptions)) {
        reportOption(node, 'options', node);
      }
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
        holdsAlongFlow(node, sink, sourceCode, (value, at) => isHostPinned(value, at, sourceCode))
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
      if (leading !== undefined) {
        checkOptions(leading, SOCKET_KEYS, node);
      } else {
        // `connect(port, host)` or `connect(path)`: a string literal is a fixed IPC path,
        // while a runtime value may be a port, a path or an options object.
        if (!isFixedValue(first, sourceCode) && !isFunctionValue(first, sourceCode)) {
          reportOption(first, 'port, path or options', first);
        }
        if (
          second !== undefined &&
          second.type !== AST_NODE_TYPES.SpreadElement &&
          peelTypes(second).type !== AST_NODE_TYPES.ObjectExpression &&
          !isFunctionValue(second, sourceCode) &&
          read(second) === undefined
        ) {
          checkHost(second, node);
        }
      }
      // `tls.connect(port, host, options)`: an options object overrides the positional host.
      for (const argument of [second, ...rest]) {
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
      CallExpression(node: TSESTree.CallExpression): void {
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
      // `axios.defaults.baseURL = x` / `api.defaults.baseURL = x` moves every relative request.
      AssignmentExpression(node: TSESTree.AssignmentExpression): void {
        const left = node.left;
        if (
          axiosSpecs.length === 0 ||
          left.type !== AST_NODE_TYPES.MemberExpression ||
          left.computed ||
          left.property.type !== AST_NODE_TYPES.Identifier ||
          left.property.name !== 'baseURL' ||
          left.object.type !== AST_NODE_TYPES.MemberExpression ||
          left.object.computed ||
          left.object.property.type !== AST_NODE_TYPES.Identifier ||
          left.object.property.name !== 'defaults'
        ) {
          return;
        }
        const receiver = left.object.object;
        if (isAxiosName(receiver, sourceCode) || isAxiosInstance(receiver, sourceCode)) {
          checkUrl(node.right, node);
        }
      },
    };
  },
});
