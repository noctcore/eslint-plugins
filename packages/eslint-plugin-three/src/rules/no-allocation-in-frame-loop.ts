import { AST_NODE_TYPES, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import { allowInSchema, FrameLoops, skipFile } from '../utils/ast';
import { isLazyInit } from '../utils/guards';
import {
  extraModulesSchema,
  isGpuResourceClass,
  readThreeImports,
  threeCoreClass,
} from '../utils/imports';

const RULE_NAME = 'no-allocation-in-frame-loop';

export interface NoAllocationInFrameLoopOptions {
  readonly allowIn?: readonly string[];
  /** Module specifiers besides three.js and R3F that mark a file as three.js code. */
  readonly extraModules?: readonly string[];
}

type RuleOptions = [NoAllocationInFrameLoopOptions];
type MessageIds = 'mathAllocation' | 'resourceAllocation';

/*
 * Code in a frame loop runs 60 to 120 times a second. A `new Vector3()` there
 * is thousands of short-lived objects a minute, and the garbage collector pays
 * for them in pauses that show up as dropped frames. A geometry, material or
 * texture built there is worse: each one is uploaded to the GPU and never
 * disposed. The fix is the same for both: create the object once (module
 * scope, a ref, `useMemo`) and reuse it with `.set()` / `.copy()`.
 *
 * Reported: `new X()` for a three.js math class (vectors, matrices,
 * quaternions, Euler angles, colors, boxes, spheres, rays, planes) or a GPU
 * resource class (geometries, materials, textures, render targets), imported
 * from `three`, inside a frame loop: R3F's `useFrame` callback,
 * `renderer.setAnimationLoop`'s callback, or a function that reschedules itself
 * with `requestAnimationFrame`. Inline callbacks inside the loop count too.
 *
 * Not reported: lazy initialisation that runs once (`ref.current ??= new
 * Vector3()`, or `ref.current = new Vector3()` under an `if`, or after an early
 * return, that tests the same target), classes not imported from `three`, and a one-shot
 * `requestAnimationFrame(() => ...)`.
 */

const MATH_CLASSES = new Set([
  'Vector2',
  'Vector3',
  'Vector4',
  'Matrix3',
  'Matrix4',
  'Quaternion',
  'Euler',
  'Color',
  'Box2',
  'Box3',
  'Sphere',
  'Ray',
  'Plane',
  'Line3',
  'Triangle',
  'Spherical',
  'Cylindrical',
  'Frustum',
  'Raycaster',
]);

export const noAllocationInFrameLoopRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow constructing three.js math objects or GPU resources inside a frame loop (`useFrame`, `setAnimationLoop`, a self-scheduling `requestAnimationFrame` function).',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { allowIn: allowInSchema, extraModules: extraModulesSchema },
      },
    ],
    messages: {
      mathAllocation:
        '`new {{name}}()` runs every frame and feeds the garbage collector, which pauses the frame to collect. Create it once (module scope, `useRef`, `useMemo`) and reuse it with `.set()` / `.copy()`.',
      resourceAllocation:
        '`new {{name}}()` runs every frame and uploads a new GPU resource each time, which is never disposed. Create it once outside the loop and update it in place.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (skipFile(context, options)) return {};
    const program = context.sourceCode.ast;
    const imports = readThreeImports(program, options.extraModules);
    const loops = new FrameLoops(context.sourceCode, imports);
    if (loops.size === 0) return {};
    const text = (node: TSESTree.Node): string => context.sourceCode.getText(node);

    return {
      NewExpression(node): void {
        const name = threeCoreClass(node, imports);
        if (name === null) return;
        const isMath = MATH_CLASSES.has(name);
        if (!isMath && !isGpuResourceClass(name)) return;
        if (loops.enclosingLoop(node) === null || isLazyInit(node)) return;
        context.report({
          node,
          messageId: isMath ? 'mathAllocation' : 'resourceAllocation',
          data: { name },
        });
      },
    };
  },
});
