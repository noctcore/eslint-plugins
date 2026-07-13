import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { walk } from '../utils';

const RULE_NAME = 'prefer-parallel-awaits';

type RuleOptions = [];
type MessageIds = 'parallelizable' | 'useParallel';

/*
 * Two or more consecutive `const x = await …()` statements whose awaited calls
 * are independent (no data dependency) and read-only-looking can run
 * concurrently with `await Promise.all([...])` instead of one-after-another.
 *
 * Deliberately narrow to avoid changing behavior:
 *   - only runs of `const <id> = await <call>()` — a single flat call whose args
 *     contain no nested call / await / assignment (side-effect ordering stays out
 *     of scope);
 *   - the callee name must not look like a mutation (`save*`, `create*`,
 *     `commit*`, …) — sequencing writes is usually intentional;
 *   - a later statement that references an earlier statement's binding is a real
 *     data dependency → the run is skipped.
 * Emitted as a SUGGESTION only (never an autofix), because parallelizing also
 * changes rejection timing.
 */
const MUTATION_PREFIXES: readonly string[] = [
  'set',
  'save',
  'update',
  'upsert',
  'insert',
  'create',
  'delete',
  'destroy',
  'remove',
  'drop',
  'write',
  'put',
  'post',
  'patch',
  'send',
  'push',
  'add',
  'emit',
  'dispatch',
  'publish',
  'begin',
  'commit',
  'rollback',
  'mutate',
  'sync',
];

interface AwaitDecl {
  readonly statement: TSESTree.VariableDeclaration;
  readonly name: string;
  readonly call: TSESTree.CallExpression;
}

/** `const <id> = await <CallExpression>` — the only statement shape the rule pairs. */
function asAwaitDecl(statement: TSESTree.Statement): AwaitDecl | null {
  if (
    statement.type !== AST_NODE_TYPES.VariableDeclaration ||
    statement.kind !== 'const' ||
    statement.declarations.length !== 1
  ) {
    return null;
  }
  const declarator = statement.declarations[0];
  if (
    declarator === undefined ||
    declarator.id.type !== AST_NODE_TYPES.Identifier ||
    declarator.init?.type !== AST_NODE_TYPES.AwaitExpression ||
    declarator.init.argument.type !== AST_NODE_TYPES.CallExpression
  ) {
    return null;
  }
  return { statement, name: declarator.id.name, call: declarator.init.argument };
}

function calleeLastName(callee: TSESTree.Node): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return null;
}

function looksLikeMutation(name: string): boolean {
  const lower = name.toLowerCase();
  return MUTATION_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** A single flat call whose subtree hides no other call/await/assignment. */
function isSimpleReadCall(call: TSESTree.CallExpression): boolean {
  const name = calleeLastName(call.callee);
  if (name === null || looksLikeMutation(name)) {
    return false;
  }
  let clean = true;
  walk(call, (node) => {
    if (node === call || !clean) {
      return;
    }
    if (
      node.type === AST_NODE_TYPES.CallExpression ||
      node.type === AST_NODE_TYPES.NewExpression ||
      node.type === AST_NODE_TYPES.AwaitExpression ||
      node.type === AST_NODE_TYPES.AssignmentExpression ||
      node.type === AST_NODE_TYPES.UpdateExpression ||
      node.type === AST_NODE_TYPES.TaggedTemplateExpression
    ) {
      clean = false;
    }
  });
  return clean;
}

/** Identifier names referenced anywhere in a node (over-broad on purpose — bias to skip). */
function referencedNames(node: TSESTree.Node): Set<string> {
  const names = new Set<string>();
  walk(node, (inner) => {
    if (inner.type === AST_NODE_TYPES.Identifier) {
      names.add(inner.name);
    }
  });
  return names;
}

export const preferParallelAwaitsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Consecutive independent `const x = await read()` statements can run concurrently via `await Promise.all([...])`.',
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      parallelizable:
        '{{count}} consecutive independent awaits run sequentially — they have no data dependency and could run concurrently with `await Promise.all([...])`.',
      useParallel: 'Combine into a single `await Promise.all([...])`.',
    },
  },
  defaultOptions: [],
  create(context) {
    function checkBlock(node: TSESTree.BlockStatement): void {
      const body = node.body;
      for (let i = 0; i < body.length; ) {
        const first = body[i];
        if (first === undefined || asAwaitDecl(first) === null) {
          i += 1;
          continue;
        }
        // Grow a maximal run of await declarations.
        const run: AwaitDecl[] = [];
        let j = i;
        for (; j < body.length; j += 1) {
          const statement = body[j];
          const decl = statement === undefined ? null : asAwaitDecl(statement);
          if (decl === null) {
            break;
          }
          run.push(decl);
        }

        if (run.length >= 2 && isParallelizable(run)) {
          reportRun(run);
        }
        i = j > i ? j : i + 1;
      }
    }

    function isParallelizable(run: readonly AwaitDecl[]): boolean {
      const introduced = new Set<string>();
      for (const decl of run) {
        if (!isSimpleReadCall(decl.call)) {
          return false;
        }
        const used = referencedNames(decl.call);
        for (const name of introduced) {
          if (used.has(name)) {
            return false; // data dependency on an earlier await.
          }
        }
        introduced.add(decl.name);
      }
      return true;
    }

    function reportRun(run: readonly AwaitDecl[]): void {
      const firstDecl = run[0];
      const lastDecl = run[run.length - 1];
      if (firstDecl === undefined || lastDecl === undefined) {
        return;
      }
      const names = run.map((decl) => decl.name);
      const exprs = run.map((decl) => context.sourceCode.getText(decl.call));
      const replacement = `const [${names.join(', ')}] = await Promise.all([${exprs.join(', ')}]);`;
      context.report({
        node: firstDecl.statement,
        messageId: 'parallelizable',
        data: { count: run.length },
        suggest: [
          {
            messageId: 'useParallel',
            fix: (fixer) =>
              fixer.replaceTextRange(
                [firstDecl.statement.range[0], lastDecl.statement.range[1]],
                replacement,
              ),
          },
        ],
      });
    }

    return {
      BlockStatement: checkBlock,
    };
  },
});
