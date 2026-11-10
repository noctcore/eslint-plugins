import { AST_NODE_TYPES, unwrapTypeWrappers, type TSESLint, type TSESTree } from '@noctcore/eslint-utils';
import { ASTUtils } from '@typescript-eslint/utils';
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
 *    but ONLY when an options object literal passes a `shell` value other than
 *    `false` (`true`, a shell path, or a runtime value such as
 *    `process.platform === 'win32'`, which is a shell on some machines). The
 *    array-args, no-shell forms are safe and left entirely alone.
 *  - A binding made with `promisify(exec)` (or `util.promisify(cp.exec)`) is
 *    followed through scope and checked like the runner it wraps.
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
      description: 'Extra callee names to treat as always-shell command runners, checked like `exec`.',
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

/**
 * True when a `shell` option value may enable a shell. Only a value that is
 * statically off (`false`, `null`, `undefined`, `''`) is safe; anything decided
 * at run time can be a shell on some machine.
 */
function isShellEnabled(node: TSESTree.Node): boolean {
  const value = unwrapTypeWrappers(node);
  if (value.type === AST_NODE_TYPES.Identifier) {
    return value.name !== 'undefined';
  }
  if (value.type !== AST_NODE_TYPES.Literal) {
    return true;
  }
  return value.value !== false && value.value !== null && value.value !== '';
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

/** True when `callee` is `promisify` or `<x>.promisify` (`util.promisify`). */
function isPromisify(callee: TSESTree.Node): boolean {
  const info = getCalleeInfo(callee);
  return info !== null && info.name === 'promisify';
}

/** The runner a `child_process` function reference names (`exec`, `cp.execFile`), else null. */
function childProcessRunner(node: TSESTree.Node): string | null {
  const info = getCalleeInfo(node);
  if (info === null) {
    return null;
  }
  if (info.isMember && !(info.objectName !== undefined && CHILD_PROCESS_OBJECT.test(info.objectName))) {
    return null;
  }
  return ALWAYS_SHELL.has(info.name) || CONDITIONAL_SHELL.has(info.name) ? info.name : null;
}

/**
 * The runner a local binding wraps when it was made with
 * `const execAsync = promisify(exec)`, followed through scope; else null.
 */
function promisifiedRunner(
  callee: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | null {
  const variable = ASTUtils.findVariable(sourceCode.getScope(callee), callee);
  const definition = variable?.defs[0];
  if (definition?.node.type !== AST_NODE_TYPES.VariableDeclarator) {
    return null;
  }
  const init = definition.node.init === null ? null : unwrapTypeWrappers(definition.node.init);
  if (init?.type !== AST_NODE_TYPES.CallExpression || !isPromisify(init.callee)) {
    return null;
  }
  const wrapped = init.arguments[0];
  return wrapped === undefined ? null : childProcessRunner(wrapped);
}

export const noShellInterpolationRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A dynamically-interpolated command string must not flow into a shell runner (`exec`/`execSync`, or `spawn`/`execFile` with a `shell` option that is not `false`), including through `promisify(exec)`. Pass the program and arguments separately.',
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
        const direct = getCalleeInfo(node.callee);
        if (direct === null) {
          return;
        }
        const wrapped =
          node.callee.type === AST_NODE_TYPES.Identifier
            ? promisifiedRunner(node.callee, context.sourceCode)
            : null;
        const info: CalleeInfo = wrapped === null ? direct : { ...direct, name: wrapped };
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
          data: { callee: direct.name },
        });
      },
    };
  },
});
