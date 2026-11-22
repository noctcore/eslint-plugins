import { AST_NODE_TYPES, calleeName, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import { allowInSchema, isAllowed, logicalParent, propertyName, unwrap } from '../utils/ast';

const RULE_NAME = 'capability-probe-performance-caveat';

export interface CapabilityProbePerformanceCaveatOptions {
  readonly allowIn?: readonly string[];
}

type RuleOptions = [CapabilityProbePerformanceCaveatOptions];
type MessageIds = 'plainProbe';

/*
 * A WebGL support check usually asks for a context and tests the result. A
 * plain `getContext('webgl2')` succeeds on a software renderer (SwiftShader,
 * llvmpipe, a GPU on the browser's blocklist), so the check says yes and the
 * scene then runs at a few frames per second, where the 2D fallback the check
 * was written for would have been the better page. The
 * `failIfMajorPerformanceCaveat: true` context attribute makes the probe fail
 * in exactly that case.
 *
 * Reported: `getContext('webgl' | 'webgl2' | 'experimental-webgl')` with no
 * options object, or one without `failIfMajorPerformanceCaveat`, whose result is
 * only tested: negated, compared with `null` / `undefined`, used as a condition,
 * passed to `Boolean()`, or held in a `const` that is used only those ways (or
 * for `getExtension()` / `getParameter()` / `getSupportedExtensions()` calls).
 *
 * Not reported: a context that is used to render (passed to a renderer,
 * returned, stored), and an options argument the rule cannot read (a
 * variable). Opt-in, because failing on software renderers is a product
 * decision: an app whose whole point is the scene may prefer to run slowly.
 */

const WEBGL_CONTEXTS = new Set(['webgl', 'webgl2', 'experimental-webgl']);
const PROBE_METHODS = new Set(['getExtension', 'getParameter', 'getSupportedExtensions']);

function isNullish(node: TSESTree.Node): boolean {
  const inner = unwrap(node);
  return (
    (inner.type === AST_NODE_TYPES.Literal && inner.value === null) ||
    (inner.type === AST_NODE_TYPES.Identifier && inner.name === 'undefined')
  );
}

/** True when the value of `node` is only tested for truthiness. */
function isTested(node: TSESTree.Node): boolean {
  const { parent, child } = logicalParent(node);
  switch (parent.type) {
    case AST_NODE_TYPES.LogicalExpression:
      return isTested(parent);
    case AST_NODE_TYPES.UnaryExpression:
      return parent.operator === '!';
    case AST_NODE_TYPES.BinaryExpression:
      return (
        ['===', '!==', '==', '!='].includes(parent.operator) &&
        isNullish(parent.left === child ? parent.right : parent.left)
      );
    case AST_NODE_TYPES.IfStatement:
    case AST_NODE_TYPES.WhileStatement:
    case AST_NODE_TYPES.DoWhileStatement:
    case AST_NODE_TYPES.ConditionalExpression:
      return parent.test === child;
    case AST_NODE_TYPES.CallExpression:
      return (
        parent.callee.type === AST_NODE_TYPES.Identifier &&
        parent.callee.name === 'Boolean' &&
        parent.arguments[0] === child
      );
    default:
      return false;
  }
}

/** True for a reference used as a probe: tested, or the receiver of a read-only query. */
function isProbeUse(reference: TSESTree.Node): boolean {
  if (isTested(reference)) return true;
  const { parent, child } = logicalParent(reference);
  if (parent.type !== AST_NODE_TYPES.MemberExpression || parent.object !== child) return false;
  const call = logicalParent(parent).parent;
  return (
    call.type === AST_NODE_TYPES.CallExpression &&
    PROBE_METHODS.has(propertyName(parent) ?? '')
  );
}

/** False when the options argument sets the caveat, or is something the rule cannot read. */
function lacksCaveat(options: TSESTree.Node | undefined): boolean {
  if (options === undefined) return true;
  const inner = unwrap(options);
  if (inner.type !== AST_NODE_TYPES.ObjectExpression) return false;
  return !inner.properties.some(
    (property) =>
      property.type === AST_NODE_TYPES.SpreadElement ||
      (property.type === AST_NODE_TYPES.Property &&
        !property.computed &&
        ((property.key.type === AST_NODE_TYPES.Identifier &&
          property.key.name === 'failIfMajorPerformanceCaveat') ||
          (property.key.type === AST_NODE_TYPES.Literal &&
            property.key.value === 'failIfMajorPerformanceCaveat'))),
  );
}

export const capabilityProbePerformanceCaveatRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require `failIfMajorPerformanceCaveat: true` on a WebGL `getContext()` call whose result is only tested, so a support check says no on software renderers.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: { allowIn: allowInSchema },
      },
    ],
    messages: {
      plainProbe:
        "This `getContext('{{kind}}')` check also succeeds on software renderers, which then run the scene at a few frames per second. Pass `{ failIfMajorPerformanceCaveat: true }` so the check falls back instead.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (isAllowed(context, options)) return {};

    /** True when the context value is only probed: tested directly or through a `const`. */
    const isProbe = (call: TSESTree.CallExpression): boolean => {
      if (isTested(call)) return true;
      // `const gl = a.getContext('webgl2') || a.getContext('webgl')`
      let value: TSESTree.Node = call;
      let { parent } = logicalParent(value);
      while (parent.type === AST_NODE_TYPES.LogicalExpression) {
        value = parent;
        parent = logicalParent(value).parent;
      }
      if (
        parent.type !== AST_NODE_TYPES.VariableDeclarator ||
        parent.id.type !== AST_NODE_TYPES.Identifier ||
        parent.parent.kind !== 'const'
      ) {
        return false;
      }
      const variable = context.sourceCode.getDeclaredVariables(parent)[0];
      const references = (variable?.references ?? []).filter((reference) => !reference.init);
      return references.length > 0 && references.every((reference) => isProbeUse(reference.identifier));
    };

    return {
      CallExpression(node): void {
        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (calleeName(node.callee) !== 'getContext') return;
        const kind = node.arguments[0];
        if (kind?.type !== AST_NODE_TYPES.Literal || typeof kind.value !== 'string') return;
        if (!WEBGL_CONTEXTS.has(kind.value)) return;
        if (!lacksCaveat(node.arguments[1])) return;
        if (!isProbe(node)) return;
        context.report({ node, messageId: 'plainProbe', data: { kind: kind.value } });
      },
    };
  },
});
