import {
  AST_NODE_TYPES,
  calleeName,
  fileMatchesAnyGlob,
  forEachDescendant,
  isFunctionNode,
  resolveAllowIn,
  unwrapTypeWrappers,
  type FunctionNode,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';

import { fiberLocal, isThreeFile, type ThreeImports } from './imports';

/** The `allowIn` schema entry every rule in this plugin shares. */
export const allowInSchema = {
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description:
    'Globs of files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root (`src/legacy/**` or `**/legacy/**`). Empty by default.',
} as const;

/** True when the file is exempt through `allowIn`. */
export function isAllowed(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  options: { readonly allowIn?: readonly string[] },
): boolean {
  const globs = resolveAllowIn(options, [], []);
  return globs.length > 0 && fileMatchesAnyGlob(context.filename, globs, context.cwd);
}

/**
 * True when the rule should skip the file: exempt through `allowIn`, or not
 * three.js code (no import of `three`, `three/*`, `three-stdlib`,
 * `@react-three/*` or one of `extraModules`).
 */
export function skipFile(
  context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>,
  options: { readonly allowIn?: readonly string[]; readonly extraModules?: readonly string[] },
): boolean {
  return isAllowed(context, options) || !isThreeFile(context.sourceCode.ast, options.extraModules);
}

/** The node under `x?.y` chains and the type wrappers (`x!`, `x as T`, `x satisfies T`). */
export function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = unwrapTypeWrappers(node);
  while (current.type === AST_NODE_TYPES.ChainExpression) {
    current = unwrapTypeWrappers(current.expression);
  }
  return current;
}

/** The parent of `node`, skipping chain and type wrappers. */
export function logicalParent(node: TSESTree.Node): { parent: TSESTree.Node; child: TSESTree.Node } {
  let child: TSESTree.Node = node;
  let parent = node.parent as TSESTree.Node;
  while (
    parent.type === AST_NODE_TYPES.ChainExpression ||
    parent.type === AST_NODE_TYPES.TSAsExpression ||
    parent.type === AST_NODE_TYPES.TSNonNullExpression ||
    parent.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    parent.type === AST_NODE_TYPES.TSTypeAssertion
  ) {
    child = parent;
    parent = parent.parent as TSESTree.Node;
  }
  return { parent, child };
}

/** The number a literal (or a negated literal) stands for, else null. */
export function numberValue(node: TSESTree.Node): number | null {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Literal && typeof inner.value === 'number') return inner.value;
  if (
    inner.type === AST_NODE_TYPES.UnaryExpression &&
    inner.operator === '-' &&
    inner.argument.type === AST_NODE_TYPES.Literal &&
    typeof inner.argument.value === 'number'
  ) {
    return -inner.argument.value;
  }
  return null;
}

/** The name of a non-computed member property, else null. */
export function propertyName(node: TSESTree.MemberExpression): string | null {
  if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) return node.property.name;
  if (
    node.computed &&
    node.property.type === AST_NODE_TYPES.Literal &&
    typeof node.property.value === 'string'
  ) {
    return node.property.value;
  }
  return null;
}

/** The identifier at the root of a member chain (`a` in `a.b.c`, `a?.b`), else null. */
export function rootIdentifier(node: TSESTree.Node): TSESTree.Identifier | null {
  let current = unwrap(node);
  while (current.type === AST_NODE_TYPES.MemberExpression) current = unwrap(current.object);
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

/**
 * A key for an identifier or a non-computed member chain (`ref.current`,
 * `this.mesh`, `a.b.c`), compared whole: `myref.current` and `ref.current`
 * differ. Null for anything else.
 */
export function chainKey(node: TSESTree.Node): string | null {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Identifier) return inner.name;
  if (inner.type === AST_NODE_TYPES.ThisExpression) return 'this';
  if (inner.type !== AST_NODE_TYPES.MemberExpression) return null;
  const property = propertyName(inner);
  const object = chainKey(inner.object);
  return property === null || object === null ? null : `${object}.${property}`;
}

/** True when `node` is a call to a React hook (`useX(...)` or `React.useX(...)`). */
export function isHookCall(node: TSESTree.Node, names?: ReadonlySet<string>): node is TSESTree.CallExpression {
  if (node.type !== AST_NODE_TYPES.CallExpression) return false;
  const name = calleeName(node.callee);
  if (name === null) return false;
  if (node.callee.type === AST_NODE_TYPES.MemberExpression) {
    const object = node.callee.object;
    if (object.type !== AST_NODE_TYPES.Identifier || object.name !== 'React') return false;
  }
  return names === undefined ? /^use[A-Z0-9]/u.test(name) : names.has(name);
}

/** The name a function is known by: its own id, or the variable it initialises. */
export function functionName(fn: FunctionNode): string | null {
  if (fn.id) return fn.id.name;
  const parent = fn.parent;
  if (
    parent.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.init === fn &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  if (
    (parent.type === AST_NODE_TYPES.MethodDefinition || parent.type === AST_NODE_TYPES.PropertyDefinition) &&
    parent.value === fn &&
    !parent.computed &&
    parent.key.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.key.name;
  }
  return null;
}

/** The class a method or class-field function belongs to, or null. */
export function classOf(fn: TSESTree.Node): TSESTree.ClassBody | null {
  const parent = fn.parent;
  if (
    (parent?.type === AST_NODE_TYPES.MethodDefinition || parent?.type === AST_NODE_TYPES.PropertyDefinition) &&
    parent.value === fn
  ) {
    return parent.parent;
  }
  return null;
}

/** True when the function is an argument of a call (an inline callback). */
export function isCallbackArgument(fn: FunctionNode): boolean {
  const parent = fn.parent;
  return (
    (parent.type === AST_NODE_TYPES.CallExpression || parent.type === AST_NODE_TYPES.NewExpression) &&
    parent.arguments.includes(fn as TSESTree.CallExpressionArgument)
  );
}

/** Names browsers expose `requestAnimationFrame` under. */
function isRequestAnimationFrame(callee: TSESTree.Node): boolean {
  return calleeName(callee) === 'requestAnimationFrame';
}

/**
 * Finds the functions that run once per frame:
 *
 * - the callback of R3F's `useFrame` (imported from `@react-three/fiber`);
 * - the callback of `renderer.setAnimationLoop(fn)`;
 * - a named function that schedules itself with `requestAnimationFrame(name)`.
 *
 * A callback is matched inline or by reference (`renderer.setAnimationLoop(tick)`
 * resolves `tick` through scope to `function tick() {}` or `const tick = () => {}`). A
 * one-shot `requestAnimationFrame(() => ...)` is not a loop and is not matched.
 */
export class FrameLoops {
  private readonly loops = new Set<TSESTree.Node>();

  constructor(sourceCode: Readonly<TSESLint.SourceCode>, imports: ThreeImports) {
    const program = sourceCode.ast;
    const keys = sourceCode.visitorKeys;
    const useFrame = fiberLocal(imports, 'useFrame');
    const functions: FunctionNode[] = [];

    forEachDescendant(program, keys, (node) => {
      if (isFunctionNode(node)) {
        functions.push(node);
        return;
      }
      if (node.type !== AST_NODE_TYPES.CallExpression) return;
      const first = node.arguments[0];
      if (first === undefined) return;
      const isUseFrame =
        useFrame !== null &&
        node.callee.type === AST_NODE_TYPES.Identifier &&
        node.callee.name === useFrame;
      const isAnimationLoop = calleeName(node.callee) === 'setAnimationLoop' &&
        node.callee.type === AST_NODE_TYPES.MemberExpression;
      if (!isUseFrame && !isAnimationLoop) return;
      if (isFunctionNode(first)) this.loops.add(first);
      else if (first.type === AST_NODE_TYPES.Identifier) {
        const target = resolveFunction(sourceCode.getScope(first), first.name);
        if (target !== null) this.loops.add(target);
      }
    });

    for (const fn of functions) {
      const name = functionName(fn);
      if (name !== null && schedulesItself(fn, name, keys)) this.loops.add(fn);
    }
  }

  /** True when `fn` is itself a per-frame function. */
  isLoop(fn: TSESTree.Node): boolean {
    return this.loops.has(fn);
  }

  /**
   * The per-frame function `node` runs in, or null. Inline callbacks inside the
   * loop (`items.forEach(...)`) run every frame too, so the search climbs through
   * them; it stops at any other function (a declared helper, a component).
   */
  enclosingLoop(node: TSESTree.Node): FunctionNode | null {
    for (let current = node.parent; current != null; current = current.parent) {
      if (!isFunctionNode(current)) continue;
      if (this.loops.has(current)) return current;
      if (!isCallbackArgument(current)) return null;
    }
    return null;
  }

  get size(): number {
    return this.loops.size;
  }
}

/** The function a name is bound to in scope (`function tick() {}`, `const tick = () => {}`), or null. */
function resolveFunction(scope: TSESLint.Scope.Scope, name: string): FunctionNode | null {
  for (let current: TSESLint.Scope.Scope | null = scope; current !== null; current = current.upper) {
    const variable = current.set.get(name);
    if (variable === undefined) continue;
    const definition = variable.defs[0]?.node;
    if (definition === undefined) return null;
    if (definition.type === AST_NODE_TYPES.FunctionDeclaration) return definition;
    if (definition.type === AST_NODE_TYPES.VariableDeclarator && definition.init !== null) {
      const init = unwrap(definition.init);
      return isFunctionNode(init) ? init : null;
    }
    return null;
  }
  return null;
}

function schedulesItself(fn: FunctionNode, name: string, keys: TSESLint.SourceCode['visitorKeys']): boolean {
  let found = false;
  forEachDescendant(fn.body, keys, (node) => {
    if (found || node.type !== AST_NODE_TYPES.CallExpression) return;
    if (!isRequestAnimationFrame(node.callee)) return;
    const first = node.arguments[0];
    if (first !== undefined && refersTo(first, name)) found = true;
  });
  return found;
}

/** True for `name`, `this.name`, or an arrow that only calls one of them. */
function refersTo(node: TSESTree.Node, name: string): boolean {
  if (node.type === AST_NODE_TYPES.Identifier) return node.name === name;
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    return node.object.type === AST_NODE_TYPES.ThisExpression && propertyName(node) === name;
  }
  if (node.type === AST_NODE_TYPES.ArrowFunctionExpression && node.body.type === AST_NODE_TYPES.CallExpression) {
    return refersTo(node.body.callee, name);
  }
  return false;
}
