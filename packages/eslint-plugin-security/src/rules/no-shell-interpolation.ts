import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-shell-interpolation';

export interface NoShellInterpolationOptions {
  readonly extraCallees?: readonly string[];
}

type RuleOptions = [NoShellInterpolationOptions];
type MessageIds = 'shellInterpolation';

/*
 * Command-injection precision. A dynamically-built command string flowing into a
 * shell runner is the classic injection sink: `exec(`git checkout ${branch}`)`
 * lets a crafted `branch` run arbitrary commands. The fix is to pass the program
 * and its arguments separately (`execFile('git', ['checkout', branch])`), where
 * the OS never re-parses a shell string.
 *
 * PRECISION IS THE POINT — this rule fires ONLY on the genuinely dangerous shape:
 *  - `exec` / `execSync` (always shell): first arg is a template literal with
 *    expressions, or a `+` concatenation with a dynamic part.
 *  - `spawn` / `spawnSync` / `execFile` / `execFileSync`: same dynamic first arg,
 *    but ONLY when an options object passes `shell: true` (or a shell path). The
 *    array-args, no-shell forms are safe and left entirely alone.
 * `exec` called as a member on a non-`child_process` object (notably
 * `regex.exec(...)`) is excluded so RegExp usage never false-positives. There is
 * no autofix — the safe rewrite changes the call shape.
 */
const ALWAYS_SHELL: ReadonlySet<string> = new Set(['exec', 'execSync']);
const CONDITIONAL_SHELL: ReadonlySet<string> = new Set([
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
]);
/** Object names that identify a `child_process` import for the `exec` member form. */
const CHILD_PROCESS_OBJECT = /^(cp|childprocess|child_process)$/i;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    extraCallees: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

interface CalleeInfo {
  readonly name: string;
  readonly isMember: boolean;
  readonly objectName: string | undefined;
}

function getCalleeInfo(callee: TSESTree.Node): CalleeInfo | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return { name: callee.name, isMember: false, objectName: undefined };
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    const objectName =
      callee.object.type === AST_NODE_TYPES.Identifier
        ? callee.object.name
        : undefined;
    return { name: callee.property.name, isMember: true, objectName };
  }
  return null;
}

/** True when a `+` tree contains at least one non-literal (dynamic) operand. */
function concatHasDynamicPart(node: TSESTree.Node): boolean {
  if (
    node.type === AST_NODE_TYPES.BinaryExpression &&
    node.operator === '+'
  ) {
    return (
      concatHasDynamicPart(node.left) || concatHasDynamicPart(node.right)
    );
  }
  return node.type !== AST_NODE_TYPES.Literal;
}

/** True when `node` builds a command string from dynamic parts at this call site. */
function isDynamicCommandString(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    return node.expressions.length > 0;
  }
  if (
    node.type === AST_NODE_TYPES.BinaryExpression &&
    node.operator === '+'
  ) {
    return concatHasDynamicPart(node);
  }
  return false;
}

/** True when a value node enables a shell (`shell: true` or a shell-path string). */
function isShellEnabled(value: TSESTree.Node): boolean {
  if (value.type !== AST_NODE_TYPES.Literal) {
    return false;
  }
  return value.value === true || (typeof value.value === 'string' && value.value !== '');
}

/** True when any argument is an options object requesting a shell. */
function argsRequestShell(args: readonly TSESTree.Node[]): boolean {
  return args.some(
    (arg) =>
      arg.type === AST_NODE_TYPES.ObjectExpression &&
      arg.properties.some(
        (prop) =>
          prop.type === AST_NODE_TYPES.Property &&
          !prop.computed &&
          ((prop.key.type === AST_NODE_TYPES.Identifier &&
            prop.key.name === 'shell') ||
            (prop.key.type === AST_NODE_TYPES.Literal &&
              prop.key.value === 'shell')) &&
          isShellEnabled(prop.value),
      ),
  );
}

export const noShellInterpolationRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A dynamically-interpolated command string must not flow into a shell runner (`exec`/`execSync`, or `spawn`/`execFile` with `shell: true`). Pass the program and arguments separately.',
    },
    schema: [optionSchema],
    messages: {
      shellInterpolation:
        'A dynamically-built command string is passed to `{{callee}}`, which runs it through a shell — a command-injection sink. Pass the program and its arguments separately instead (e.g. `execFile(cmd, [arg1, arg2])`), where no shell re-parses the string.',
    },
  },
  defaultOptions: [{ extraCallees: [] }],
  create(context, [options]) {
    const extra = options.extraCallees ?? [];
    const alwaysShell = new Set([...ALWAYS_SHELL, ...extra]);

    return {
      CallExpression(node): void {
        const info = getCalleeInfo(node.callee);
        if (info === null) {
          return;
        }
        // Exclude `regex.exec(...)`: `exec` as a member on a non-child_process
        // object is RegExp.prototype.exec, never a shell runner.
        if (
          info.name === 'exec' &&
          info.isMember &&
          !(info.objectName !== undefined && CHILD_PROCESS_OBJECT.test(info.objectName))
        ) {
          return;
        }

        const command = node.arguments[0];
        if (command === undefined || command.type === AST_NODE_TYPES.SpreadElement) {
          return;
        }

        const runsShell =
          alwaysShell.has(info.name) ||
          (CONDITIONAL_SHELL.has(info.name) && argsRequestShell(node.arguments));
        if (!runsShell) {
          return;
        }
        if (!isDynamicCommandString(command)) {
          return;
        }
        context.report({
          node: command,
          messageId: 'shellInterpolation',
          data: { callee: info.name },
        });
      },
    };
  },
});
