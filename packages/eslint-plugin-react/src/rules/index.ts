import { contextValueMustBeMemoizedRule } from './context-value-must-be-memoized';
import { maxHookReturnSurfaceRule } from './max-hook-return-surface';
import { maxHooksPerFileRule } from './max-hooks-per-file';
import { maxPropsPerComponentRule } from './max-props-per-component';
import { noJsxComputationRule } from './no-jsx-computation';
import { noPropDrillingRule } from './no-prop-drilling';
import { noStateInComponentBodyRule } from './no-state-in-component-body';
import { propsMustBeVisualRule } from './props-must-be-visual';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'context-value-must-be-memoized': contextValueMustBeMemoizedRule,
  'max-hook-return-surface': maxHookReturnSurfaceRule,
  'max-hooks-per-file': maxHooksPerFileRule,
  'max-props-per-component': maxPropsPerComponentRule,
  'no-jsx-computation': noJsxComputationRule,
  'no-prop-drilling': noPropDrillingRule,
  'no-state-in-component-body': noStateInComponentBodyRule,
  'props-must-be-visual': propsMustBeVisualRule,
};
