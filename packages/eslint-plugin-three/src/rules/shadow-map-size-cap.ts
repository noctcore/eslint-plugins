import { AST_NODE_TYPES, calleeName, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import { allowInSchema, isAllowed, numberValue, propertyName, unwrap } from '../utils/ast';

const RULE_NAME = 'shadow-map-size-cap';

export interface ShadowMapSizeCapOptions {
  readonly allowIn?: readonly string[];
  /** The largest shadow map width or height allowed. */
  readonly maxMapSize?: number;
}

type RuleOptions = [ShadowMapSizeCapOptions];
type MessageIds = 'aboveCap';

/*
 * Every shadow-casting light renders its casters into a depth texture of
 * `shadow.mapSize` each frame it updates. Memory and fill cost grow with the
 * square of the size: a 4096 map is four times a 2048 one, and a point light
 * renders six of them. On integrated and mobile GPUs that is often the
 * largest single cost in a scene.
 *
 * Reported, for literal numbers above `maxMapSize`:
 * - `light.shadow.mapSize.set(w, h)` and `.setScalar(n)`;
 * - `light.shadow.mapSize.width = n` (also `height`, `x`, `y`);
 * - R3F props: `shadow-mapSize={[w, h]}`, `shadow-mapSize={n}`,
 *   `shadow-mapSize-width={n}`, `shadow-mapSize-height={n}`.
 *
 * Not reported: sizes the rule cannot read (a variable, a quality setting).
 * Opt-in: the right budget depends on the devices a project targets.
 */

const AXES = new Set(['width', 'height', 'x', 'y']);

/** True for `<anything>.shadow.mapSize`. */
function isShadowMapSize(node: TSESTree.Node): boolean {
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.MemberExpression || propertyName(inner) !== 'mapSize') return false;
  const holder = unwrap(inner.object);
  return holder.type === AST_NODE_TYPES.MemberExpression && propertyName(holder) === 'shadow';
}

export const shadowMapSizeCapRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a light `shadow.mapSize` above a cap, set in code or through R3F `shadow-mapSize` props.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowIn: allowInSchema,
          maxMapSize: {
            type: 'integer',
            minimum: 1,
            description: 'The largest shadow map width or height allowed. Defaults to 2048.',
          },
        },
      },
    ],
    messages: {
      aboveCap:
        'Shadow map size {{value}} is above the cap of {{max}}. Each shadow-casting light re-renders its casters at this size, and the cost grows with its square.',
    },
  },
  defaultOptions: [{ maxMapSize: 2048 }],
  create(context, [options]) {
    if (isAllowed(context, options)) return {};
    const max = options.maxMapSize ?? 2048;

    const check = (node: TSESTree.Node | null | undefined): void => {
      if (node == null || node.type === AST_NODE_TYPES.SpreadElement) return;
      const value = numberValue(node);
      if (value === null || value <= max) return;
      context.report({ node, messageId: 'aboveCap', data: { value: String(value), max: String(max) } });
    };

    return {
      CallExpression(node): void {
        const callee = node.callee;
        if (callee.type !== AST_NODE_TYPES.MemberExpression || !isShadowMapSize(callee.object)) return;
        const method = calleeName(callee);
        if (method === 'set' || method === 'setScalar') node.arguments.forEach(check);
      },
      AssignmentExpression(node): void {
        const left = node.left;
        if (left.type !== AST_NODE_TYPES.MemberExpression) return;
        if (!AXES.has(propertyName(left) ?? '') || !isShadowMapSize(left.object)) return;
        check(node.right);
      },
      JSXAttribute(node): void {
        if (node.name.type !== AST_NODE_TYPES.JSXIdentifier) return;
        const name = node.name.name;
        if (!name.startsWith('shadow-mapSize')) return;
        const value = node.value;
        if (value?.type !== AST_NODE_TYPES.JSXExpressionContainer) return;
        const expression = value.expression;
        if (expression.type === AST_NODE_TYPES.JSXEmptyExpression) return;
        if (name === 'shadow-mapSize') {
          const inner = unwrap(expression);
          if (inner.type === AST_NODE_TYPES.ArrayExpression) inner.elements.forEach(check);
          else check(expression);
          return;
        }
        if (['shadow-mapSize-width', 'shadow-mapSize-height', 'shadow-mapSize-x', 'shadow-mapSize-y'].includes(name)) {
          check(expression);
        }
      },
    };
  },
});
