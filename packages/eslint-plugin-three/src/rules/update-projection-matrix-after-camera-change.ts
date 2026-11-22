import {
  AST_NODE_TYPES,
  calleeName,
  enclosingFunction,
  forEachDescendant,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import {
  allowInSchema,
  classOf,
  propertyName,
  rootIdentifier,
  skipFile,
  unwrap,
} from '../utils/ast';
import { extraModulesSchema } from '../utils/imports';

const RULE_NAME = 'update-projection-matrix-after-camera-change';

export interface UpdateProjectionMatrixOptions {
  readonly allowIn?: readonly string[];
  /** Module specifiers besides three.js and R3F that mark a file as three.js code. */
  readonly extraModules?: readonly string[];
  /** Regular expression a receiver's name must match to count as a camera. */
  readonly cameraNames?: string;
}

type RuleOptions = [UpdateProjectionMatrixOptions];
type MessageIds = 'missingUpdate';

/*
 * A camera's projection matrix is computed by `updateProjectionMatrix()` and
 * nowhere else. Assigning `fov`, `aspect`, `near`, `far`, `zoom`, the film
 * fields or an orthographic bound changes the property and nothing on screen:
 * the scene keeps rendering through the old matrix (a stretched image after a
 * resize, a zoom that does nothing) until something else happens to call it.
 *
 * The rule reports such an assignment when nothing after it in the same
 * function updates the projection:
 * - `.updateProjectionMatrix()` on any receiver (so an alias such as
 *   `const cam = ref.current` does not matter);
 * - `setFocalLength()`, `setLens()`, `setViewOffset()` or `clearViewOffset()`,
 *   which call it themselves;
 * - handing the camera to any call (`applyCamera(camera)`), which may update it.
 *
 * A function that writes the projection matrix itself (`projectionMatrix.copy()`,
 * `.set()`, `.elements[i] = ...`, as oblique-clipping and off-axis code does) is
 * skipped: it manages the projection by hand.
 *
 * A light's shadow camera (`light.shadow.camera`, or a `const` read from it) is
 * skipped: the renderer calls `updateProjectionMatrix()` on it when it first
 * allocates the shadow map, so setting its bounds before the first render needs
 * no call. A class method passes when any method of its class calls
 * `updateProjectionMatrix()` (a resize handler that sets `aspect`, an
 * `update()` that runs every frame).
 *
 * A receiver counts as a camera by name only: the last name in the chain
 * (`camera`, `this.camera`, `light.shadow.camera`, `mainCamera`, `cameraRef.current`
 * read as `camera`) must match `cameraNames`.
 */

const PROJECTION_FIELDS = new Set([
  'fov',
  'aspect',
  'near',
  'far',
  'zoom',
  'left',
  'right',
  'top',
  'bottom',
  'filmGauge',
  'filmOffset',
]);

/** Methods that recompute the projection themselves. */
const UPDATING_METHODS = new Set([
  'updateProjectionMatrix',
  'setFocalLength',
  'setLens',
  'setViewOffset',
  'clearViewOffset',
]);

/** `x.projectionMatrix.copy(...)`, `.set(...)`, `.elements[i] = ...`, `x.projectionMatrix = ...`. */
const WRITES_PROJECTION =
  /\.projectionMatrix\s*(?:\.\s*(?:copy|set|multiply|premultiply|makePerspective|makeOrthographic|fromArray|identity|elements)\b|=[^=])/u;

const DEFAULT_CAMERA_NAMES = '^(?:cam|camera|[A-Za-z_$][\\w$]*Camera)$';

/** True for `x.shadow.camera`, or a `const` initialised from one. */
function isShadowCamera(node: TSESTree.Node, scope: TSESLint.Scope.Scope): boolean {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.MemberExpression) {
    const holder = unwrap(inner.object);
    return (
      propertyName(inner) === 'camera' &&
      holder.type === AST_NODE_TYPES.MemberExpression &&
      propertyName(holder) === 'shadow'
    );
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) return false;
  for (let current: TSESLint.Scope.Scope | null = scope; current !== null; current = current.upper) {
    const variable = current.set.get(inner.name);
    if (variable === undefined) continue;
    const definition = variable.defs[0];
    if (definition?.node.type !== AST_NODE_TYPES.VariableDeclarator) return false;
    const init = definition.node.init;
    return init !== null && init !== undefined && unwrap(init) !== inner && isShadowCamera(init, current);
  }
  return false;
}

/** The name the receiver goes by: `camera` for `this.camera`, `cameraRef.current` and `camera!`. */
function receiverName(node: TSESTree.Node): string | null {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Identifier) return inner.name;
  if (inner.type !== AST_NODE_TYPES.MemberExpression) return null;
  const name = propertyName(inner);
  if (name === 'current') {
    const holder = receiverName(inner.object);
    return holder === null ? null : holder.replace(/Ref$/u, '');
  }
  return name;
}

export const updateProjectionMatrixAfterCameraChangeRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `camera.updateProjectionMatrix()` after assigning a projection field (`fov`, `aspect`, `near`, `far`, `zoom`, orthographic bounds) in the same function.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowIn: allowInSchema,
          extraModules: extraModulesSchema,
          cameraNames: {
            type: 'string',
            minLength: 1,
            description:
              'Regular expression (no flags) the last name of the receiver must match to count as a camera. Defaults to `^(?:cam|camera|[A-Za-z_$][\\w$]*Camera)$`.',
          },
        },
      },
    ],
    messages: {
      missingUpdate:
        '`{{text}}` changes the camera, but nothing after it in this function calls `updateProjectionMatrix()`, so the scene keeps rendering through the old projection.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (skipFile(context, options)) return {};
    const cameraNames = new RegExp(options.cameraNames ?? DEFAULT_CAMERA_NAMES, 'u');
    const keys = context.sourceCode.visitorKeys;

    /** True when something after `node` in `scope` updates the projection or takes the camera. */
    const updatedLater = (
      scope: TSESTree.Node,
      node: TSESTree.Node,
      handles: ReadonlySet<string>,
    ): boolean => {
      const after = node.range[1];
      let updated = false;
      forEachDescendant(scope, keys, (candidate) => {
        if (updated || candidate.range[0] < after || candidate.type !== AST_NODE_TYPES.CallExpression) {
          return;
        }
        const name = calleeName(candidate.callee);
        if (
          name !== null &&
          UPDATING_METHODS.has(name) &&
          candidate.callee.type === AST_NODE_TYPES.MemberExpression
        ) {
          updated = true;
          return;
        }
        for (const argument of candidate.arguments) {
          if (handles.has(context.sourceCode.getText(unwrap(argument)))) updated = true;
        }
      });
      return updated;
    };

    return {
      AssignmentExpression(node): void {
        const target = node.left;
        if (target.type !== AST_NODE_TYPES.MemberExpression) return;
        const field = propertyName(target);
        if (field === null || !PROJECTION_FIELDS.has(field)) return;
        const name = receiverName(target.object);
        if (name === null || !cameraNames.test(name)) return;
        if (isShadowCamera(target.object, context.sourceCode.getScope(node))) return;

        const fn = enclosingFunction(node);
        const scope: TSESTree.Node = fn ?? context.sourceCode.ast;
        // A function that writes the projection matrix by hand owns it.
        if (WRITES_PROJECTION.test(context.sourceCode.getText(scope))) return;
        // The camera handed to a call, as written or by its root (`state` of `state.camera`).
        const handles = new Set([context.sourceCode.getText(unwrap(target.object))]);
        const root = rootIdentifier(target.object);
        if (root !== null) handles.add(root.name);
        if (updatedLater(scope, node, handles)) return;
        // A class method: another method of the same class (an update() run every
        // frame, a resize handler) may update it.
        const owner = fn === null ? null : classOf(fn);
        if (owner !== null && /\.updateProjectionMatrix\s*\(/u.test(context.sourceCode.getText(owner))) return;
        context.report({
          node,
          messageId: 'missingUpdate',
          data: { text: context.sourceCode.getText(target) },
        });
      },
    };
  },
});
