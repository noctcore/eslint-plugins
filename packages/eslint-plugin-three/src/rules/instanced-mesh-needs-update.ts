import {
  AST_NODE_TYPES,
  calleeName,
  enclosingFunction,
  forEachDescendant,
  isFunctionNode,
  type FunctionNode,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import {
  allowInSchema,
  chainKey,
  classOf,
  logicalParent,
  propertyName,
  rootIdentifier,
  skipFile,
  unwrap,
} from '../utils/ast';
import { extraModulesSchema } from '../utils/imports';

const RULE_NAME = 'instanced-mesh-needs-update';

export interface InstancedMeshNeedsUpdateOptions {
  readonly allowIn?: readonly string[];
  /** Module specifiers besides three.js and R3F that mark a file as three.js code. */
  readonly extraModules?: readonly string[];
}

type RuleOptions = [InstancedMeshNeedsUpdateOptions];
type MessageIds = 'missingNeedsUpdate';

/*
 * `InstancedMesh.setMatrixAt()` and `setColorAt()` write into a CPU-side
 * array. The GPU copy is re-uploaded only when the attribute's `needsUpdate`
 * flag is set, which three.js documents as required after either call. Without
 * it the instances stay where they were on the last upload: an animation that
 * never moves, a recolor that never shows.
 *
 * Reported: the first `setMatrixAt()` (or `setColorAt()`) in a function with no
 * `.instanceMatrix.needsUpdate = ...` (or `.instanceColor.needsUpdate = ...`)
 * assignment anywhere in that function. Array callbacks (`forEach`, `map`, ...)
 * and local helpers (`const place = (i) => mesh.setMatrixAt(i, m)`) are read as
 * part of the function around them, so a loop over instances followed by one
 * flag is fine. A class method reads its whole class (`push()` writes, `end()`
 * sets the flag).
 *
 * Not reported: a function that receives the mesh as a parameter (a helper
 * whose caller sets the flag), or that hands the mesh to another call (which
 * may set it, and `scene.add(mesh)` means it has not been uploaded yet), that
 * returns the mesh, or that constructs it (`const mesh = new InstancedMesh()`):
 * a mesh still being built has never been uploaded.
 * `BatchedMesh` has a `setMatrixAt()` too and uploads by itself, so the rule
 * only runs in a file that names `InstancedMesh` (an import, a type, a `new`,
 * or R3F's `<instancedMesh>`), and skips receivers whose name says `batch` or
 * that resolve to one (`useRef<BatchedMesh>()`, `x = new BatchedMesh()`).
 */

const NAMES_INSTANCED_MESH = /\bInstancedMesh\b|<instancedMesh\b/u;
const BATCHED = /batch/iu;

const WRITES = {
  setMatrixAt: 'instanceMatrix',
  setColorAt: 'instanceColor',
} as const;
type Write = keyof typeof WRITES;

const ITERATION_METHODS = new Set([
  'forEach',
  'map',
  'flatMap',
  'filter',
  'reduce',
  'some',
  'every',
  'traverse',
]);

/** True for a helper declared inside another function (`const place = () => ...`, `function place() {}`). */
function isLocalHelper(fn: FunctionNode): boolean {
  const parent = fn.parent;
  const declared =
    fn.type === AST_NODE_TYPES.FunctionDeclaration ||
    (parent.type === AST_NODE_TYPES.VariableDeclarator && parent.init === fn);
  return declared && enclosingFunction(fn) !== null;
}

/**
 * The node whose body is read for the flag. Climbs out of array-iteration
 * callbacks and local helpers, which run as part of the function around them.
 * A class method reads its whole class, for the `begin()` / `push()` / `end()`
 * shape where one method writes and another sets the flag.
 */
function flagScope(node: TSESTree.Node): { scope: TSESTree.Node | null; chain: FunctionNode[] } {
  const chain: FunctionNode[] = [];
  for (let current = node.parent; current != null; current = current.parent) {
    if (!isFunctionNode(current)) continue;
    chain.push(current);
    const parent = current.parent;
    const isIterationCallback =
      parent.type === AST_NODE_TYPES.CallExpression &&
      parent.arguments.includes(current as TSESTree.CallExpressionArgument) &&
      ITERATION_METHODS.has(calleeName(parent.callee) ?? '');
    if (isIterationCallback || isLocalHelper(current)) continue;
    return { scope: classOf(current) ?? current, chain };
  }
  return { scope: null, chain };
}

function isParameterOf(name: string, fn: FunctionNode): boolean {
  return fn.params.some((param) => {
    const target = param.type === AST_NODE_TYPES.AssignmentPattern ? param.left : param;
    return target.type === AST_NODE_TYPES.Identifier && target.name === name;
  });
}

export const instancedMeshNeedsUpdateRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `instanceMatrix.needsUpdate` (or `instanceColor.needsUpdate`) to be set in the function that calls `setMatrixAt()` (or `setColorAt()`) on an `InstancedMesh`.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { allowIn: allowInSchema, extraModules: extraModulesSchema },
      },
    ],
    messages: {
      missingNeedsUpdate:
        '`{{method}}()` writes the CPU copy only. Set `{{receiver}}.{{attribute}}.needsUpdate = true` after the writes in this function, or the GPU keeps the old instances.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (skipFile(context, options)) return {};
    if (!NAMES_INSTANCED_MESH.test(context.sourceCode.text)) return {};
    const keys = context.sourceCode.visitorKeys;
    const reported = new Set<string>();

    /** True for `new BatchedMesh(...)` or `new THREE.BatchedMesh(...)`. */
    const isBatchedNew = (node: TSESTree.Node | null | undefined): boolean => {
      if (node == null) return false;
      const inner = unwrap(node);
      if (inner.type !== AST_NODE_TYPES.NewExpression) return false;
      const callee = inner.callee;
      const name =
        callee.type === AST_NODE_TYPES.Identifier
          ? callee.name
          : callee.type === AST_NODE_TYPES.MemberExpression
            ? propertyName(callee)
            : null;
      return name === 'BatchedMesh';
    };

    /** True when `node` is the left side of `= new BatchedMesh()` and reads as `key`. */
    const assignsBatched = (node: TSESTree.Node, key: string): boolean => {
      const { parent, child } = logicalParent(node);
      return (
        parent.type === AST_NODE_TYPES.AssignmentExpression &&
        parent.left === child &&
        chainKey(node) === key &&
        isBatchedNew(parent.right)
      );
    };

    /** The outermost member chain that starts at `node` (`ref` in `ref.current` gives `ref.current`). */
    const chainTop = (node: TSESTree.Node): TSESTree.Node => {
      let current = node;
      for (;;) {
        const { parent, child } = logicalParent(current);
        if (parent.type !== AST_NODE_TYPES.MemberExpression || parent.object !== child) return current;
        current = parent;
      }
    };

    /** The nearest class body around `node`. */
    const nearestClassBody = (node: TSESTree.Node): TSESTree.ClassBody | null => {
      for (let current = node.parent; current != null; current = current.parent) {
        if (current.type === AST_NODE_TYPES.ClassBody) return current;
      }
      return null;
    };

    /**
     * True when the receiver is known to be a `BatchedMesh`. The receiver's
     * root is resolved through scope, and only that same variable (or, for
     * `this.x`, the same class) counts: its declaration is `new BatchedMesh()`
     * or `useRef<BatchedMesh>()`, or a write to the same chain assigns
     * `new BatchedMesh()`. Another component's `ref.current`, a `myref.current`
     * or another class's `this.mesh` does not.
     */
    const isBatchedMesh = (object: TSESTree.Node): boolean => {
      const key = chainKey(object);
      if (key === null) return false;
      if (key.startsWith('this.')) {
        const body = nearestClassBody(object);
        if (body === null) return false;
        const field = key.slice('this.'.length);
        let found = false;
        forEachDescendant(body, keys, (node) => {
          if (found) return;
          if (
            node.type === AST_NODE_TYPES.PropertyDefinition &&
            !node.computed &&
            node.key.type === AST_NODE_TYPES.Identifier &&
            node.key.name === field &&
            node.parent === body &&
            isBatchedNew(node.value)
          ) {
            found = true;
          } else if (
            node.type === AST_NODE_TYPES.MemberExpression &&
            nearestClassBody(node) === body &&
            assignsBatched(node, key)
          ) {
            found = true;
          }
        });
        return found;
      }
      const root = rootIdentifier(object);
      if (root === null) return false;
      for (let scope: TSESLint.Scope.Scope | null = context.sourceCode.getScope(object); scope !== null; scope = scope.upper) {
        const variable = scope.set.get(root.name);
        if (variable === undefined) continue;
        const definition = variable.defs[0]?.node;
        if (
          definition?.type === AST_NODE_TYPES.VariableDeclarator &&
          definition.init !== null &&
          /\bBatchedMesh\b/u.test(context.sourceCode.getText(definition.init))
        ) {
          return true;
        }
        return variable.references.some((reference) => assignsBatched(chainTop(reference.identifier), key));
      }
      return false;
    };

    /** True when `scope` assigns `<x>.<attribute>.needsUpdate` or hands `root` to a call. */
    const isHandled = (
      scope: TSESTree.Node,
      attribute: string,
      receiver: string,
      root: string | null,
    ): boolean => {
      let handled = false;
      forEachDescendant(scope, keys, (node) => {
        if (handled) return;
        if (node.type === AST_NODE_TYPES.AssignmentExpression) {
          // `this.mesh = new InstancedMesh(...)`: built here, never uploaded yet.
          if (
            context.sourceCode.getText(unwrap(node.left)) === receiver &&
            unwrap(node.right).type === AST_NODE_TYPES.NewExpression
          ) {
            handled = true;
            return;
          }
          const left = node.left;
          if (left.type !== AST_NODE_TYPES.MemberExpression || propertyName(left) !== 'needsUpdate') return;
          const holder = unwrap(left.object);
          if (holder.type === AST_NODE_TYPES.MemberExpression && propertyName(holder) === attribute) {
            handled = true;
          }
          return;
        }
        // Returned to the caller, or created here: not uploaded yet, or someone else's to flag.
        if (node.type === AST_NODE_TYPES.ReturnStatement && node.argument !== null) {
          const value = context.sourceCode.getText(unwrap(node.argument));
          if (value === receiver || (root !== null && rootIdentifier(node.argument)?.name === root)) {
            handled = true;
          }
          return;
        }
        if (root === null) return;
        if (
          node.type === AST_NODE_TYPES.VariableDeclarator &&
          node.id.type === AST_NODE_TYPES.Identifier &&
          node.id.name === root &&
          node.init !== null &&
          unwrap(node.init).type === AST_NODE_TYPES.NewExpression
        ) {
          handled = true;
          return;
        }
        if (node.type !== AST_NODE_TYPES.CallExpression) return;
        if (node.arguments.some((argument) => rootIdentifier(argument)?.name === root)) handled = true;
      });
      return handled;
    };

    return {
      CallExpression(node): void {
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression) return;
        const method = calleeName(callee);
        if (method !== 'setMatrixAt' && method !== 'setColorAt') return;
        if (node.arguments.length !== 2) return;
        const attribute = WRITES[method as Write];
        const receiver = context.sourceCode.getText(unwrap(callee.object));
        if (BATCHED.test(receiver) || isBatchedMesh(callee.object)) return;

        const found = flagScope(node);
        const root = rootIdentifier(callee.object);
        if (root !== null && found.chain.some((link) => isParameterOf(root.name, link))) return;

        const scope: TSESTree.Node = found.scope ?? context.sourceCode.ast;
        const key = `${scope.range[0]}:${attribute}`;
        if (reported.has(key)) return;
        // The mesh's own calls (`mesh.setMatrixAt(...)`) have it as receiver, not argument.
        if (isHandled(scope, attribute, receiver, root?.name ?? null)) return;
        reported.add(key);
        context.report({
          node,
          messageId: 'missingNeedsUpdate',
          data: {
            method,
            attribute,
            receiver,
          },
        });
      },
    };
  },
});
