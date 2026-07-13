import { componentPropsNamingRule } from './component-props-naming';
import { contextValueMustBeMemoizedRule } from './context-value-must-be-memoized';
import { maxHookReturnSurfaceRule } from './max-hook-return-surface';
import { maxHooksPerFileRule } from './max-hooks-per-file';
import { maxPropsPerComponentRule } from './max-props-per-component';
import { noEffectDerivedStateRule } from './no-effect-derived-state';
import { noJsxComputationRule } from './no-jsx-computation';
import { noJsxInHooksRule } from './no-jsx-in-hooks';
import { noPropDrillingRule } from './no-prop-drilling';
import { noStateInComponentBodyRule } from './no-state-in-component-body';
import { preferLazyStateInitRule } from './prefer-lazy-state-init';
import { propsMustBeVisualRule } from './props-must-be-visual';
import { requireEffectCancellationRule } from './require-effect-cancellation';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'component-props-naming': componentPropsNamingRule,
  'context-value-must-be-memoized': contextValueMustBeMemoizedRule,
  'max-hook-return-surface': maxHookReturnSurfaceRule,
  'max-hooks-per-file': maxHooksPerFileRule,
  'max-props-per-component': maxPropsPerComponentRule,
  'no-effect-derived-state': noEffectDerivedStateRule,
  'no-jsx-computation': noJsxComputationRule,
  'no-jsx-in-hooks': noJsxInHooksRule,
  'no-prop-drilling': noPropDrillingRule,
  'no-state-in-component-body': noStateInComponentBodyRule,
  'prefer-lazy-state-init': preferLazyStateInitRule,
  'props-must-be-visual': propsMustBeVisualRule,
  'require-effect-cancellation': requireEffectCancellationRule,
};
