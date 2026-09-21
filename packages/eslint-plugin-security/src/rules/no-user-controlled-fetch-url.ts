/*
 * Ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/runtime-boundaries/rules/no-user-controlled-fetch-url.ts.
 * Changed in the port: configurable `fetchCallees` (upstream hardcodes `fetch`
 * and `axios.get/post`), in-file `const` resolution, `+` concatenation,
 * `new URL(...)`, and the trusted-origin / sanitizer / trusted-path options.
 */
import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  calleeSpecSchema,
  hasFixedOrigin,
  matchCallee,
  normalizeTrust,
  trustSchemaProperties,
  type UrlCalleeSpec,
  type UrlTrustOptions,
  urlArgumentOf,
} from '../url-origin';

const RULE_NAME = 'no-user-controlled-fetch-url';

export interface NoUserControlledFetchUrlOptions extends UrlTrustOptions {
  /** Call shapes that issue an HTTP request. Replaces the defaults when set. */
  readonly fetchCallees?: readonly UrlCalleeSpec[];
}

type RuleOptions = [NoUserControlledFetchUrlOptions];
type MessageIds = 'userControlledFetchUrl';

const AXIOS_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export const DEFAULT_FETCH_CALLEES: readonly UrlCalleeSpec[] = [
  { name: 'fetch' },
  ...AXIOS_METHODS.map((name) => ({ object: 'axios', name })),
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    fetchCallees: { type: 'array', items: calleeSpecSchema },
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
    },
    schema: [optionSchema],
    messages: {
      userControlledFetchUrl:
        'HTTP request URL `{{url}}` must have a fixed origin. Use a literal, or a template whose host is author-written and closed by `/`, `?` or `#` before the first `${...}`: `fetch(`/api/todos/${id}`)` is fine; `fetch(url)`, `fetch(`https://${host}/x`)` and `fetch(`https://api.example.com${path}`)` are not. A configured base URL goes in `trustedOrigins`.',
    },
  },
  defaultOptions: [
    { fetchCallees: DEFAULT_FETCH_CALLEES, trustedOrigins: [], sanitizers: [], trustedPaths: [] },
  ],
  create(context, [options]) {
    const callees = options.fetchCallees ?? DEFAULT_FETCH_CALLEES;
    const trust = normalizeTrust(options);
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node: TSESTree.CallExpression): void {
        const spec = matchCallee(node, callees, sourceCode);
        if (spec === undefined) {
          return;
        }
        const urlArg = urlArgumentOf(node, spec);
        if (urlArg === undefined) {
          return;
        }
        if (!hasFixedOrigin(urlArg, trust, sourceCode)) {
          context.report({
            node: urlArg,
            messageId: 'userControlledFetchUrl',
            data: { url: sourceCode.getText(urlArg) },
          });
        }
      },
    };
  },
});
