import {
  AST_NODE_TYPES,
  calleeName,
  isFunctionNode,
  isNode,
  type FunctionNode,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import {
  allowInSchema,
  isHookCall,
  logicalParent,
  rootIdentifier,
  skipFile,
  unwrap,
} from '../utils/ast';
import {
  extraModulesSchema,
  isGpuResourceClass,
  readThreeImports,
  threeCoreClass,
} from '../utils/imports';

const RULE_NAME = 'require-dispose';

export interface RequireDisposeOptions {
  readonly allowIn?: readonly string[];
  /** Module specifiers besides three.js and R3F that mark a file as three.js code. */
  readonly extraModules?: readonly string[];
}

type RuleOptions = [RequireDisposeOptions];
type MessageIds = 'notDisposed';

/*
 * three.js frees a geometry's buffers, a material's programs and a texture's
 * image on the GPU only when `dispose()` is called; removing the mesh from the
 * scene frees nothing. R3F disposes what it creates from JSX when it unmounts,
 * but not what an effect builds by hand. An effect that creates a resource,
 * puts it in the scene and only removes the mesh on cleanup leaks the
 * resource on every unmount and on every re-run of the effect.
 *
 * Reported: a `const` / `let` in a `useEffect` / `useLayoutEffect` callback,
 * initialised with `new X()` for a three.js geometry, material, texture or
 * render target, that is never `.dispose()`d in the effect, when the effect
 * either returns a cleanup or adds the resource to the scene (`.add(mesh)`). A
 * resource counts as in the scene through the object that holds it: `new
 * Mesh(geometry, material)` or `material.map = texture` on a local. Disposing
 * the holder itself does not count (`material.dispose()` leaves its `map`
 * alone); `holder.geometry.dispose()` does.
 *
 * Not reported, because the resource may be disposed somewhere else:
 * - it leaves the effect: stored in a ref or an outer variable, passed to a
 *   plain function call (`setGeometry(g)`, `track(g)`), pushed into a list,
 *   returned, or put in an object or array literal;
 * - the cleanup hands it, or its holder, to any call but `remove()` / `detach()`
 *   (`release(mesh)`), calls any function whose name contains `dispose` with
 *   letters after it (`disposeObject(child)`, `disposeAll()`), or walks the scene
 *   with `traverse()`;
 * - a resource neither added to the scene nor followed by a cleanup, which is
 *   never uploaded to the GPU in the first place.
 */

const EFFECT_HOOKS = new Set(['useEffect', 'useLayoutEffect']);
const NON_DISPOSING = new Set(['remove', 'detach', 'removeFromParent']);
const STORING_METHODS = new Set(['push', 'unshift', 'set', 'splice']);

type Keys = TSESLint.SourceCode['visitorKeys'];

/** Visits every node under `root`, not descending into nested functions. */
function walkOwnBody(root: TSESTree.Node, keys: Keys, visit: (node: TSESTree.Node) => void): void {
  const stack: TSESTree.Node[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    visit(node);
    if (node !== root && isFunctionNode(node)) continue;
    for (const key of keys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key);
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) if (isNode(child)) stack.push(child);
    }
  }
}

/** True when `node` is inside `ancestor`. */
function within(node: TSESTree.Node, ancestor: TSESTree.Node): boolean {
  return node.range[0] >= ancestor.range[0] && node.range[1] <= ancestor.range[1];
}

/** The cleanup functions the effect callback returns. */
function cleanups(callback: FunctionNode, keys: Keys): FunctionNode[] {
  if (callback.body.type !== AST_NODE_TYPES.BlockStatement) {
    return isFunctionNode(callback.body) ? [callback.body] : [];
  }
  const found: FunctionNode[] = [];
  walkOwnBody(callback.body, keys, (node) => {
    if (node.type !== AST_NODE_TYPES.ReturnStatement || node.argument === null) return;
    const value = unwrap(node.argument);
    if (isFunctionNode(value)) found.push(value);
  });
  return found;
}

export const requireDisposeRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `dispose()` for three.js geometries, materials, textures and render targets that a React effect creates and puts in the scene.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { allowIn: allowInSchema, extraModules: extraModulesSchema },
      },
    ],
    messages: {
      notDisposed:
        '`{{name}}` (a `{{className}}`) is created in this effect and never disposed, so its GPU memory leaks on every unmount and re-run. Call `{{name}}.dispose()` in the effect cleanup.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (skipFile(context, options)) return {};
    const imports = readThreeImports(context.sourceCode.ast);
    const keys = context.sourceCode.visitorKeys;
    const sourceCode = context.sourceCode;

    /** The non-declaration references of the variable a declarator binds. */
    const referencesOf = (declarator: TSESTree.VariableDeclarator): TSESTree.Identifier[] => {
      const variable = sourceCode.getDeclaredVariables(declarator)[0];
      return (variable?.references ?? [])
        .filter((reference) => !reference.init)
        .map((reference) => reference.identifier as TSESTree.Identifier);
    };

    const checkEffect = (callback: FunctionNode): void => {
      const locals = new Set<string>();
      const resources: { declarator: TSESTree.VariableDeclarator; name: string; className: string }[] = [];
      walkOwnBody(callback.body, keys, (node) => {
        if (node.type !== AST_NODE_TYPES.VariableDeclarator || node.id.type !== AST_NODE_TYPES.Identifier) return;
        locals.add(node.id.name);
        const init = node.init === null ? null : unwrap(node.init);
        if (init?.type !== AST_NODE_TYPES.NewExpression) return;
        const className = threeCoreClass(init, imports);
        if (className !== null && isGpuResourceClass(className)) {
          resources.push({ declarator: node, name: node.id.name, className });
        }
      });
      if (resources.length === 0) return;
      const returned = cleanups(callback, keys);
      const cleanupText = returned.map((fn) => sourceCode.getText(fn));
      // A cleanup that walks the scene or calls a disposal helper disposes what it finds.
      const disposesGenerically = cleanupText.some((text) =>
        /\.traverse\s*\(|\b\w*[dD]ispose\w+\s*\(/u.test(text),
      );
      if (disposesGenerically) return;

      for (const resource of resources) {
        // The resource and the locals that hold it (`new Mesh(geometry)`, `material.map = texture`).
        const handles = new Map<string, TSESTree.Identifier[]>([[resource.name, referencesOf(resource.declarator)]]);
        let disposed = false;
        let escaped = false;
        let inScene = false;

        for (let index = 0; index < handles.size; index += 1) {
          const references = [...handles.values()][index] ?? [];
          // `material.dispose()` frees the material, not its `map`: only the
          // resource's own dispose, or a holder's `holder.geometry.dispose()`, counts.
          const isHolder = index > 0;
          for (const reference of references) {
            if (!within(reference, callback)) {
              escaped = true;
              continue;
            }
            let { parent, child } = logicalParent(reference);
            // `i === 0 ? geometry : geometry.clone()`, `texture ?? fallback`: read through to the use.
            while (
              (parent.type === AST_NODE_TYPES.ConditionalExpression && parent.test !== child) ||
              parent.type === AST_NODE_TYPES.LogicalExpression
            ) {
              ({ parent, child } = logicalParent(parent));
            }
            const inCleanup = returned.some((fn) => within(reference, fn));

            // x.dispose(), or holder.geometry.dispose()
            if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === child) {
              let top: TSESTree.Node = parent;
              while (logicalParent(top).parent.type === AST_NODE_TYPES.MemberExpression) {
                const next = logicalParent(top).parent as TSESTree.MemberExpression;
                if (next.object !== logicalParent(top).child) break;
                top = next;
              }
              const call = logicalParent(top).parent;
              if (call.type === AST_NODE_TYPES.CallExpression && call.callee === logicalParent(top).child) {
                if (calleeName(call.callee) === 'dispose' && (!isHolder || top !== parent)) disposed = true;
              }
              continue;
            }

            if (parent.type === AST_NODE_TYPES.CallExpression && parent.arguments.includes(child as TSESTree.CallExpressionArgument)) {
              const method = calleeName(parent.callee);
              if (inCleanup) {
                if (!NON_DISPOSING.has(method ?? '')) disposed = true;
              } else if (parent.callee.type === AST_NODE_TYPES.Identifier || STORING_METHODS.has(method ?? '')) {
                escaped = true;
              } else if (method === 'add' || method === 'attach') {
                inScene = true;
              }
              continue;
            }

            if (parent.type === AST_NODE_TYPES.NewExpression) {
              // new Mesh(geometry, material): the mesh now holds it.
              const { parent: outer, child: holderNode } = logicalParent(parent);
              if (outer.type === AST_NODE_TYPES.VariableDeclarator && outer.id.type === AST_NODE_TYPES.Identifier) {
                if (!handles.has(outer.id.name)) handles.set(outer.id.name, referencesOf(outer));
              } else if (
                outer.type === AST_NODE_TYPES.CallExpression &&
                outer.arguments.includes(holderNode as TSESTree.CallExpressionArgument) &&
                ['add', 'attach'].includes(calleeName(outer.callee) ?? '')
              ) {
                // scene.add(new Mesh(geometry, material))
                inScene = true;
              } else {
                escaped = true;
              }
              continue;
            }

            if (parent.type === AST_NODE_TYPES.AssignmentExpression && parent.right === child) {
              const root = rootIdentifier(parent.left);
              if (root !== null && locals.has(root.name) && parent.left.type === AST_NODE_TYPES.MemberExpression) {
                const holder = [...handles.keys()].includes(root.name) ? null : root.name;
                if (holder !== null) {
                  const declarator = findDeclarator(callback, holder, keys);
                  if (declarator !== null) handles.set(holder, referencesOf(declarator));
                }
              } else {
                escaped = true;
              }
              continue;
            }

            if (
              parent.type === AST_NODE_TYPES.ReturnStatement ||
              parent.type === AST_NODE_TYPES.ArrayExpression ||
              parent.type === AST_NODE_TYPES.Property ||
              parent.type === AST_NODE_TYPES.SpreadElement ||
              parent.type === AST_NODE_TYPES.JSXExpressionContainer ||
              parent.type === AST_NODE_TYPES.VariableDeclarator
            ) {
              escaped = true;
            }
          }
        }

        if (disposed || escaped) continue;
        if (returned.length === 0 && !inScene) continue;
        context.report({
          node: resource.declarator,
          messageId: 'notDisposed',
          data: { name: resource.name, className: resource.className },
        });
      }
    };

    return {
      CallExpression(node): void {
        if (!isHookCall(node, EFFECT_HOOKS)) return;
        const callback = node.arguments[0];
        if (callback !== undefined && isFunctionNode(callback)) checkEffect(callback);
      },
    };
  },
});

/** The declarator of `name` in the effect's own body, or null. */
function findDeclarator(callback: FunctionNode, name: string, keys: Keys): TSESTree.VariableDeclarator | null {
  let found: TSESTree.VariableDeclarator | null = null;
  walkOwnBody(callback.body, keys, (node) => {
    if (
      found === null &&
      node.type === AST_NODE_TYPES.VariableDeclarator &&
      node.id.type === AST_NODE_TYPES.Identifier &&
      node.id.name === name
    ) {
      found = node;
    }
  });
  return found as TSESTree.VariableDeclarator | null;
}
