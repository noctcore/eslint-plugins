import { AST_NODE_TYPES, calleeName, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';
import { allowInSchema, numberValue, propertyName, skipFile, unwrap } from '../utils/ast';
import { extraModulesSchema, fiberLocal, readThreeImports } from '../utils/imports';

const RULE_NAME = 'renderer-dpr-cap';

export interface RendererDprCapOptions {
  readonly allowIn?: readonly string[];
  /** Module specifiers besides three.js and R3F that mark a file as three.js code. */
  readonly extraModules?: readonly string[];
  /** The highest pixel ratio a renderer may run at. */
  readonly maxDpr?: number;
}

type RuleOptions = [RendererDprCapOptions];
type MessageIds = 'uncapped' | 'aboveCap';

/*
 * The cost of a fragment shader scales with the square of the pixel ratio: a
 * phone at devicePixelRatio 3 shades 9 pixels for every CSS pixel, 2.25 times
 * the work of a ratio of 2 for a difference few people can see. three.js takes
 * whatever ratio it is given, so `setPixelRatio(window.devicePixelRatio)` runs
 * at 3 or 4 on the devices with the weakest GPUs per pixel. R3F's `<Canvas>`
 * already defaults to `dpr={[1, 2]}`, so a Canvas without `dpr` is fine; one
 * that passes the raw ratio, or a fixed value above the cap, is not.
 *
 * Reported, all syntactic:
 * - `setPixelRatio(devicePixelRatio)` (any receiver: renderers and composers);
 * - `setPixelRatio(n)` and `Math.min(devicePixelRatio, n)` with a literal `n` above the cap;
 * - `Math.max(devicePixelRatio, n)`, which raises the floor and caps nothing;
 * - the same values in R3F's `<Canvas dpr={...}>`, including the max of `[min, max]`.
 *
 * Any other expression (a variable, a store value, a function call) is left
 * alone: the rule cannot see its value.
 */

/** True for `devicePixelRatio`, `window.devicePixelRatio`, `globalThis.devicePixelRatio`, `self.devicePixelRatio`. */
function isDevicePixelRatio(node: TSESTree.Node): boolean {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Identifier) return inner.name === 'devicePixelRatio';
  if (inner.type !== AST_NODE_TYPES.MemberExpression || propertyName(inner) !== 'devicePixelRatio') {
    return false;
  }
  const object = unwrap(inner.object);
  return (
    object.type === AST_NODE_TYPES.Identifier &&
    (object.name === 'window' || object.name === 'globalThis' || object.name === 'self')
  );
}

/** `min` or `max` for a `Math.min(...)` / `Math.max(...)` call, else null. */
function mathMinMax(node: TSESTree.Node): { kind: 'min' | 'max'; args: readonly TSESTree.Node[] } | null {
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.CallExpression) return null;
  const callee = unwrap(inner.callee);
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    unwrap(callee.object).type !== AST_NODE_TYPES.Identifier ||
    (unwrap(callee.object) as TSESTree.Identifier).name !== 'Math'
  ) {
    return null;
  }
  const name = propertyName(callee);
  if (name !== 'min' && name !== 'max') return null;
  if (inner.arguments.some((arg) => arg.type === AST_NODE_TYPES.SpreadElement)) return null;
  return { kind: name, args: inner.arguments };
}

type Verdict = { kind: 'uncapped' } | { kind: 'aboveCap'; value: number } | null;

/** What a pixel-ratio expression is known to be, or null when the rule cannot tell. */
function judge(node: TSESTree.Node, maxDpr: number): Verdict {
  if (isDevicePixelRatio(node)) return { kind: 'uncapped' };
  const literal = numberValue(node);
  if (literal !== null) return literal > maxDpr ? { kind: 'aboveCap', value: literal } : null;

  const math = mathMinMax(node);
  if (math === null || !math.args.some(isDevicePixelRatio)) return null;
  if (math.kind === 'max') return { kind: 'uncapped' };
  // Math.min(devicePixelRatio, ...): capped by its smallest literal, if every
  // other argument is a literal the rule can read.
  const others = math.args.filter((arg) => !isDevicePixelRatio(arg));
  const values = others.map(numberValue);
  if (values.length === 0 || values.some((value) => value === null)) return null;
  const cap = Math.min(...(values as number[]));
  return cap > maxDpr ? { kind: 'aboveCap', value: cap } : null;
}

export const rendererDprCapRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a renderer pixel ratio taken straight from `devicePixelRatio` or set above a cap, in `setPixelRatio()` and R3F `<Canvas dpr>`.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowIn: allowInSchema,
          extraModules: extraModulesSchema,
          maxDpr: {
            type: 'number',
            minimum: 1,
            description: 'The highest pixel ratio a renderer may run at. Defaults to 2, the cap R3F uses by default.',
          },
        },
      },
    ],
    messages: {
      uncapped:
        'Pixel ratio taken from `devicePixelRatio` with no cap. On a 3x phone this shades 9 pixels per CSS pixel. Cap it: `Math.min(window.devicePixelRatio, {{max}})`, or `dpr={[1, {{max}}]}` on a Canvas.',
      aboveCap:
        'Pixel ratio of {{value}} is above the cap of {{max}}. Fragment cost grows with the square of the ratio, so cap it at {{max}}.',
    },
  },
  defaultOptions: [{ maxDpr: 2 }],
  create(context, [options]) {
    if (skipFile(context, options)) return {};
    const maxDpr = options.maxDpr ?? 2;
    const canvas = fiberLocal(readThreeImports(context.sourceCode.ast), 'Canvas');

    const report = (node: TSESTree.Node, verdict: Verdict): void => {
      if (verdict === null) return;
      if (verdict.kind === 'uncapped') {
        context.report({ node, messageId: 'uncapped', data: { max: String(maxDpr) } });
      } else {
        context.report({
          node,
          messageId: 'aboveCap',
          data: { value: String(verdict.value), max: String(maxDpr) },
        });
      }
    };

    return {
      CallExpression(node): void {
        if (node.callee.type !== AST_NODE_TYPES.MemberExpression) return;
        if (calleeName(node.callee) !== 'setPixelRatio') return;
        const first = node.arguments[0];
        if (first === undefined || first.type === AST_NODE_TYPES.SpreadElement) return;
        report(first, judge(first, maxDpr));
      },
      JSXAttribute(node): void {
        if (canvas === null || node.name.type !== AST_NODE_TYPES.JSXIdentifier || node.name.name !== 'dpr') {
          return;
        }
        const element = node.parent;
        if (
          element.type !== AST_NODE_TYPES.JSXOpeningElement ||
          element.name.type !== AST_NODE_TYPES.JSXIdentifier ||
          element.name.name !== canvas
        ) {
          return;
        }
        const value = node.value;
        if (value?.type !== AST_NODE_TYPES.JSXExpressionContainer) return;
        const expression = value.expression;
        if (expression.type === AST_NODE_TYPES.JSXEmptyExpression) return;
        const inner = unwrap(expression);
        if (inner.type === AST_NODE_TYPES.ArrayExpression) {
          const max = inner.elements[1];
          if (max != null && max.type !== AST_NODE_TYPES.SpreadElement) report(max, judge(max, maxDpr));
          return;
        }
        report(expression, judge(expression, maxDpr));
      },
    };
  },
});
