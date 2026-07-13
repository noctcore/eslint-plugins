import { type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { isStaticMemberAccess } from '../utils/ast';
import { matchesAny } from '../utils/allowMatch';
import { createRule } from '../createRule';

const RULE_NAME = 'no-process-exit';

export interface NoProcessExitOptions {
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoProcessExitOptions];
type MessageIds = 'processExit';

/*
 * `process.exit()` belongs only to bootstrap/shutdown paths and standalone
 * CLIs, never to request-scoped or renderer code where it would kill the whole
 * process mid-flight. Scripts, CLI entrypoints, and config files are the
 * legitimate exit sites; consumers override `allowIn` (a list of globs matched
 * against the file path) to express their own boundary.
 */
const DEFAULT_ALLOW_IN: readonly string[] = [
  '**/scripts/**',
  '**/bin/**',
  '**/cli/**',
  '**/*.config.{ts,js,mjs,cjs,cts,mts}',
];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowIn: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

// Matches both `process.exit(...)` and `process['exit'](...)` so a computed
// callee cannot bypass the rule.
function isProcessExit(node: TSESTree.CallExpression): boolean {
  return isStaticMemberAccess(node.callee, 'process', 'exit');
}

export const noProcessExitRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `process.exit()` outside bootstrap/shutdown paths and standalone CLIs. Application and service code must throw or reject so the lifecycle can shut down gracefully.',
    },
    schema: [optionSchema],
    messages: {
      processExit:
        '`process.exit()` is reserved for bootstrap/shutdown and CLI entrypoints. Throw or reject and let the lifecycle handle teardown.',
    },
  },
  defaultOptions: [{ allowIn: [...DEFAULT_ALLOW_IN] }],
  create(context, [options]) {
    const allowIn = options.allowIn ?? DEFAULT_ALLOW_IN;

    if (matchesAny(context.filename, allowIn)) {
      return {};
    }

    return {
      CallExpression(node): void {
        if (isProcessExit(node)) {
          context.report({ node, messageId: 'processExit' });
        }
      },
    };
  },
});
