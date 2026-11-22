import {
  AST_NODE_TYPES,
  calleeName,
  enclosingFunction,
  walkSome,
  type FunctionNode,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import { allowInSchema, functionName, isAllowed, isHookCall, logicalParent } from '../utils/ast';
import {
  importsAnyThree,
  isGpuResourceClass,
  isLoaderClass,
  readThreeImports,
  threeAddonClass,
  threeCoreClass,
} from '../utils/imports';

const RULE_NAME = 'no-resource-creation-in-render';

export interface NoResourceCreationInRenderOptions {
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoResourceCreationInRenderOptions];
type MessageIds = 'resourceInRender';

/*
 * A React component body runs on every render. A geometry, material, texture
 * or render target constructed there is a new GPU resource each time: the old
 * one is dropped without `dispose()`, so GPU memory climbs with every
 * re-render, and the new one is uploaded again. A loader built there throws
 * away its cache. The resource belongs in `useMemo`, a lazy `useState` /
 * `useRef` initialiser, `useLoader`, or module scope.
 *
 * Reported: `new X()` for a three.js geometry, material, texture, render target
 * or loader (from `three`, `three/addons`, `three/examples/jsm` or
 * `three-stdlib`), directly in the body of a component: a PascalCase function
 * (declared, assigned, or wrapped in `memo` / `forwardRef`) that returns JSX or
 * calls a hook.
 *
 * Not reported: construction inside any nested function (hook callbacks, event
 * handlers), as a direct argument of a hook (`useRef(new X())`: discarded after
 * the first render and never uploaded), in a PascalCase function that is
 * neither (a vanilla three.js factory), and math objects (`Vector3`), which
 * hold no GPU memory.
 */

const WRAPPERS = new Set(['memo', 'forwardRef']);

/** The component function `fn` is, by its name or the wrapper it is passed to. */
function componentName(fn: FunctionNode): string | null {
  const direct = functionName(fn);
  if (direct !== null) return direct;
  // const Scene = memo(() => ...), memo(forwardRef(function (...) {...}))
  let current: TSESTree.Node = fn;
  while (
    current.parent?.type === AST_NODE_TYPES.CallExpression &&
    WRAPPERS.has(calleeName(current.parent.callee) ?? '')
  ) {
    current = current.parent;
  }
  const parent = current.parent;
  if (
    current !== fn &&
    parent?.type === AST_NODE_TYPES.VariableDeclarator &&
    parent.id.type === AST_NODE_TYPES.Identifier
  ) {
    return parent.id.name;
  }
  if (current !== fn && parent?.type === AST_NODE_TYPES.ExportDefaultDeclaration) return 'Default';
  return null;
}

/** True when a PascalCase function contains JSX or a hook call. */
function looksLikeComponent(fn: FunctionNode, keys: TSESLint.SourceCode['visitorKeys']): boolean {
  const name = componentName(fn) ?? (fn.parent.type === AST_NODE_TYPES.ExportDefaultDeclaration ? 'Default' : null);
  if (name === null || !/^[A-Z]/u.test(name)) return false;
  return walkSome(fn.body, keys, (node) => isJsx(node) || isHookCall(node));
}

function isJsx(node: TSESTree.Node): boolean {
  return node.type === AST_NODE_TYPES.JSXElement || node.type === AST_NODE_TYPES.JSXFragment;
}

export const noResourceCreationInRenderRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow constructing three.js geometries, materials, textures, render targets or loaders directly in a React component body, where every render makes a new one.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { allowIn: allowInSchema },
      },
    ],
    messages: {
      resourceInRender:
        '`new {{name}}()` in the body of `{{component}}` runs on every render, leaking the previous one and uploading a new one. Wrap it in `useMemo(() => new {{name}}(...), [deps])`, or move it to module scope.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (isAllowed(context, options)) return {};
    const imports = readThreeImports(context.sourceCode.ast);
    if (!importsAnyThree(imports)) return {};
    const keys = context.sourceCode.visitorKeys;
    const verdicts = new Map<FunctionNode, boolean>();

    return {
      NewExpression(node): void {
        const name = threeCoreClass(node, imports) ?? threeAddonClass(node, imports);
        if (name === null || (!isGpuResourceClass(name) && !isLoaderClass(name))) return;
        const fn = enclosingFunction(node);
        if (fn === null) return;
        const { parent } = logicalParent(node);
        if (isHookCall(parent)) return;
        let isComponent = verdicts.get(fn);
        if (isComponent === undefined) {
          isComponent = looksLikeComponent(fn, keys);
          verdicts.set(fn, isComponent);
        }
        if (!isComponent) return;
        context.report({
          node,
          messageId: 'resourceInRender',
          data: { name, component: componentName(fn) ?? 'the component' },
        });
      },
    };
  },
});
