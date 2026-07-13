import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { matchesAnyGlob } from '../utils';

const RULE_NAME = 'no-shared-mutable-module-state';

export interface NoSharedMutableModuleStateOptions {
  readonly include?: readonly string[];
  readonly allow?: readonly string[];
}

type RuleOptions = [NoSharedMutableModuleStateOptions];
type MessageIds = 'sharedMutableState';

/*
 * On a server, module scope is shared by every concurrent request. A module-level
 * `let` (or a mutable container `const c = []` / `new Map()`) written from inside
 * an EXPORTED async function or route handler is cross-request contamination:
 * request B sees state left by request A.
 *
 * OPT-IN by design: with no `include` glob (the default) the rule is inert, so a
 * legit client-side module cache is never touched. Point `include` at server
 * files (`['**\/server/**', '**\/*.server.ts']`) to arm it. `allow` exempts
 * intentional singletons/memoization by binding name, and the lazy-init idioms
 * `x ??= …` / `x ||= …` are always skipped. No fix — the fix (scope per request,
 * or guard) is the author's.
 */
const CONTAINER_CTORS: ReadonlySet<string> = new Set([
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Array',
]);

const MUTATING_METHODS: ReadonlySet<string> = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

const HANDLER_NAMES: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'loader',
  'action',
  'handler',
  'middleware',
]);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    include: { type: 'array', items: { type: 'string' }, uniqueItems: true },
    allow: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

type AnyFunction =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

function isHandlerName(name: string | null): boolean {
  return name !== null && (HANDLER_NAMES.has(name) || name.endsWith('Handler'));
}

function qualifies(fn: AnyFunction, name: string | null): boolean {
  return fn.async || isHandlerName(name);
}

/** Whether a `const` initializer is a mutable container (`[]`, `{}`, `new Map()`, …). */
function isContainerInit(init: TSESTree.Expression | null | undefined): boolean {
  if (!init) {
    return false;
  }
  if (
    init.type === AST_NODE_TYPES.ArrayExpression ||
    init.type === AST_NODE_TYPES.ObjectExpression
  ) {
    return true;
  }
  return (
    init.type === AST_NODE_TYPES.NewExpression &&
    init.callee.type === AST_NODE_TYPES.Identifier &&
    CONTAINER_CTORS.has(init.callee.name)
  );
}

interface Binding {
  readonly reassignable: boolean;
}

/** Classify a module-scope variable as a mutable binding, or `null` if immutable/irrelevant. */
function classify(variable: TSESLint.Scope.Variable): Binding | null {
  const def = variable.defs[0];
  if (def === undefined || def.type !== 'Variable' || def.parent.type !== AST_NODE_TYPES.VariableDeclaration) {
    return null;
  }
  const kind = def.parent.kind;
  if (kind === 'let' || kind === 'var') {
    return { reassignable: true };
  }
  // `const`: only a mutable container counts.
  const declarator = def.node;
  if (declarator.type === AST_NODE_TYPES.VariableDeclarator && isContainerInit(declarator.init)) {
    return { reassignable: false };
  }
  return null;
}

function isLazyInit(identifier: TSESTree.Identifier): boolean {
  const parent = identifier.parent;
  return (
    parent.type === AST_NODE_TYPES.AssignmentExpression &&
    parent.left === identifier &&
    (parent.operator === '??=' || parent.operator === '||=')
  );
}

/** A read of the binding that mutates the container it points at (`x.push()`, `x[i] = …`). */
function isContainerMutation(identifier: TSESTree.Identifier): boolean {
  const member = identifier.parent;
  if (member.type !== AST_NODE_TYPES.MemberExpression || member.object !== identifier) {
    return false;
  }
  const outer = member.parent;
  if (outer.type === AST_NODE_TYPES.AssignmentExpression && outer.left === member) {
    return true; // `x.p = …` / `x[i] = …`
  }
  if (outer.type === AST_NODE_TYPES.UpdateExpression && outer.argument === member) {
    return true; // `x.p++`
  }
  return (
    outer.type === AST_NODE_TYPES.CallExpression &&
    outer.callee === member &&
    !member.computed &&
    member.property.type === AST_NODE_TYPES.Identifier &&
    MUTATING_METHODS.has(member.property.name)
  );
}

function moduleScopeOf(scope: TSESLint.Scope.Scope): TSESLint.Scope.Scope {
  if (scope.type === 'module') {
    return scope;
  }
  const child = scope.childScopes.find((inner) => inner.type === 'module');
  return child ?? scope;
}

/** Nearest ancestor of `node` that is one of the exported functions, or null. */
function enclosingExportedFn(
  node: TSESTree.Node,
  exported: ReadonlyMap<AnyFunction, string | null>,
): string | null | undefined {
  for (let current: TSESTree.Node | undefined = node.parent; current; current = current.parent) {
    if (exported.has(current as AnyFunction)) {
      return exported.get(current as AnyFunction);
    }
  }
  return undefined;
}

function collectExportedFns(program: TSESTree.Program): Map<AnyFunction, string | null> {
  const result = new Map<AnyFunction, string | null>();
  const addFn = (fn: AnyFunction, name: string | null): void => {
    if (qualifies(fn, name)) {
      result.set(fn, name);
    }
  };

  for (const statement of program.body) {
    if (statement.type === AST_NODE_TYPES.ExportNamedDeclaration && statement.declaration) {
      const decl = statement.declaration;
      if (decl.type === AST_NODE_TYPES.FunctionDeclaration) {
        addFn(decl, decl.id ? decl.id.name : null);
      } else if (decl.type === AST_NODE_TYPES.VariableDeclaration) {
        for (const d of decl.declarations) {
          if (
            d.id.type === AST_NODE_TYPES.Identifier &&
            d.init &&
            (d.init.type === AST_NODE_TYPES.ArrowFunctionExpression ||
              d.init.type === AST_NODE_TYPES.FunctionExpression)
          ) {
            addFn(d.init, d.id.name);
          }
        }
      }
    } else if (statement.type === AST_NODE_TYPES.ExportDefaultDeclaration) {
      const decl = statement.declaration;
      if (
        decl.type === AST_NODE_TYPES.FunctionDeclaration ||
        decl.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        decl.type === AST_NODE_TYPES.FunctionExpression
      ) {
        addFn(decl, decl.type === AST_NODE_TYPES.FunctionDeclaration && decl.id ? decl.id.name : null);
      }
    }
  }
  return result;
}

export const noSharedMutableModuleStateRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A module-scoped mutable binding written inside an exported async/handler function is shared across concurrent requests. Opt in per file via `include`.',
    },
    schema: [optionSchema],
    messages: {
      sharedMutableState:
        'Module-scoped mutable `{{name}}` is written inside exported `{{fn}}` — concurrent requests share this state and can contaminate each other. Scope it per request, or guard it.',
    },
  },
  defaultOptions: [{ include: [], allow: [] }],
  create(context, [options]) {
    const include = options.include ?? [];
    if (!matchesAnyGlob(context.filename, include)) {
      return {};
    }
    const allow = new Set(options.allow ?? []);

    return {
      Program(program: TSESTree.Program): void {
        const exported = collectExportedFns(program);
        if (exported.size === 0) {
          return;
        }
        const moduleScope = moduleScopeOf(context.sourceCode.getScope(program));

        for (const variable of moduleScope.variables) {
          if (allow.has(variable.name)) {
            continue;
          }
          const binding = classify(variable);
          if (binding === null) {
            continue;
          }
          for (const ref of variable.references) {
            const id = ref.identifier;
            if (id.type !== AST_NODE_TYPES.Identifier) {
              continue;
            }
            let isWrite = false;
            if (binding.reassignable && ref.isWrite() && !ref.init) {
              if (isLazyInit(id)) {
                continue; // lazy singleton / memoization idiom.
              }
              isWrite = true;
            } else if (ref.isRead() && isContainerMutation(id)) {
              isWrite = true;
            }
            if (!isWrite) {
              continue;
            }
            const fnName = enclosingExportedFn(id, exported);
            if (fnName === undefined) {
              continue; // not inside an exported async/handler function.
            }
            context.report({
              node: id,
              messageId: 'sharedMutableState',
              data: { name: variable.name, fn: fnName ?? 'default export' },
            });
          }
        }
      },
    };
  },
});
