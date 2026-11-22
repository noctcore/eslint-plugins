/*
 * Ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/runtime-boundaries/rules/no-user-controlled-redirect.ts.
 * Changed in the port: configurable `redirectCallees` with a URL argument
 * index (upstream reads argument 0 only, so Express `res.redirect(302, url)`
 * was never seen), and a fixed-origin check in place of upstream's
 * literal-only check, sharing the SSRF rule's trusted-origin vocabulary.
 * Added here: `Location` header writes (`res.location`, `res.set('Location')`,
 * `res.writeHead(302, { Location })`), sinks after chained response calls,
 * and host-pinned targets (`new URL(url).hostname` checked against an
 * allowlist before the redirect, see `../guards`).
 */
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
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

const RULE_NAME = 'no-user-controlled-redirect';

export interface NoUserControlledRedirectOptions extends UrlTrustOptions {
  /** Call shapes that redirect. Replaces the defaults when set. */
  readonly redirectCallees?: readonly UrlCalleeEntry[];
  /**
   * Receivers whose `set` / `header` / `setHeader` / `writeHead` calls write a
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
];

/** Receivers whose header writes are checked for `Location`. */
export const DEFAULT_RESPONSE_OBJECTS: readonly string[] = ['res', 'response', 'reply'];

/** Methods that set one header: `res.set(name, value)`, `reply.header(name, value)`. */
const HEADER_SETTERS: ReadonlySet<string> = new Set(['set', 'header', 'setHeader', 'headers']);

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

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

/** The receiver with response-returning calls peeled: `res.status(302)` gives `res`. */
function rootReceiver(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.CallExpression &&
    current.callee.type === AST_NODE_TYPES.MemberExpression &&
    !current.callee.computed &&
    current.callee.property.type === AST_NODE_TYPES.Identifier &&
    CHAINABLE.has(current.callee.property.name)
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
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  return { method: callee.property.name, receiver: squash(sourceCode.getText(rootReceiver(callee.object))) };
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
          spec.object !== undefined && spec.name === parts.method && squash(spec.object) === parts.receiver,
      );
}

function isLocationName(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string' && node.value.toLowerCase() === 'location';
}

/** The `Location` value of an object literal of headers, else undefined. */
function locationProperty(node: TSESTree.Node | undefined): TSESTree.Expression | undefined {
  if (node?.type !== AST_NODE_TYPES.ObjectExpression) {
    return undefined;
  }
  for (const property of node.properties) {
    if (property.type !== AST_NODE_TYPES.Property || property.computed) {
      continue;
    }
    const named =
      (property.key.type === AST_NODE_TYPES.Identifier && property.key.name.toLowerCase() === 'location') ||
      isLocationName(property.key);
    if (named && property.value.type !== AST_NODE_TYPES.AssignmentPattern && property.value.type !== AST_NODE_TYPES.ObjectPattern && property.value.type !== AST_NODE_TYPES.ArrayPattern && property.value.type !== AST_NODE_TYPES.TSEmptyBodyFunctionExpression) {
      return property.value;
    }
  }
  return undefined;
}

/**
 * The `Location` value a header write sets on a response object:
 * `res.set('Location', url)`, `res.header('location', url)`,
 * `res.setHeader('Location', url)`, `res.set({ Location: url })` and
 * `res.writeHead(302, { Location: url })`, also after chained calls.
 */
function locationHeaderValue(
  node: TSESTree.CallExpression,
  responseObjects: ReadonlySet<string>,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression | undefined {
  const parts = memberCallParts(node, sourceCode);
  if (parts === null || !responseObjects.has(parts.receiver)) {
    return undefined;
  }
  const [first, second] = node.arguments;
  if (HEADER_SETTERS.has(parts.method)) {
    if (first !== undefined && isLocationName(first)) {
      return second === undefined || second.type === AST_NODE_TYPES.SpreadElement ? undefined : second;
    }
    return node.arguments.length === 1 ? locationProperty(first) : undefined;
  }
  if (parts.method === 'writeHead') {
    return locationProperty(node.arguments.at(-1));
  }
  return undefined;
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
        'Receivers whose `set`, `header`, `setHeader` and `writeHead` calls are checked for a `Location` header. Replaces the defaults (`res`, `response`, `reply`).',
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

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const spec = matchRedirectCallee(node, callees, sourceCode);
        const urlArg =
          spec === undefined
            ? locationHeaderValue(node, responseObjects, sourceCode)
            : urlArgumentOf(node, spec);
        if (urlArg === undefined) {
          return;
        }
        if (hasFixedOrigin(urlArg, trust, sourceCode) || isHostPinned(urlArg, node, sourceCode)) {
          return;
        }
        context.report({
          node: urlArg,
          messageId: 'userControlledRedirect',
          data: { url: sourceCode.getText(urlArg) },
        });
      },
    };
  },
});
