/*
 * Ported from tsforge (MIT License, Copyright (c) 2026 Aleksandar Grbic).
 * Provenance: boringstack-xyz/tsforge@75100ffd54fafc4874375e28f6865198dcb91839,
 * packages/core/src/rule-packs/runtime-boundaries/rules/no-user-controlled-redirect.ts.
 * Changed in the port: configurable `redirectCallees` with a URL argument
 * index (upstream reads argument 0 only, so Express `res.redirect(302, url)`
 * was never seen), and a fixed-origin check in place of upstream's
 * literal-only check, sharing the SSRF rule's trusted-origin vocabulary.
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

const RULE_NAME = 'no-user-controlled-redirect';

export interface NoUserControlledRedirectOptions extends UrlTrustOptions {
  /** Call shapes that redirect. Replaces the defaults when set. */
  readonly redirectCallees?: readonly UrlCalleeSpec[];
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
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    redirectCallees: { type: 'array', items: calleeSpecSchema },
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
      trustedOrigins: [],
      sanitizers: [],
      trustedPaths: [],
    },
  ],
  create(context, [options]) {
    const callees = options.redirectCallees ?? DEFAULT_REDIRECT_CALLEES;
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
            messageId: 'userControlledRedirect',
            data: { url: sourceCode.getText(urlArg) },
          });
        }
      },
    };
  },
});
