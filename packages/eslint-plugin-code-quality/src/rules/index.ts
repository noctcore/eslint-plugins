import { fakeTimersMustBeRestoredRule } from './fake-timers-must-be-restored';
import { interfacePrefixIRule } from './interface-prefix-i';
import { noBareDateNowRule } from './no-bare-date-now';
import { noConditionalExpectRule } from './no-conditional-expect';
import { noFocusedTestsRule } from './no-focused-tests';
import { noHistoricalCommentsRule } from './no-historical-comments';
import { noNarrationCommentsRule } from './no-narration-comments';
import { noPrReferenceCommentsRule } from './no-pr-reference-comments';
import { noProcessExitRule } from './no-process-exit';
import { noRealNetworkInUnitTestsRule } from './no-real-network-in-unit-tests';
import { noTemplateTrimEmptyTernaryRule } from './no-template-trim-empty-ternary';
import { preferEarlyReturnRule } from './prefer-early-return';
import { noVacuousExpectRule } from './no-vacuous-expect';
import { skippedTestsNeedTrackingRule } from './skipped-tests-need-tracking';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'prefer-early-return': preferEarlyReturnRule,
  'no-process-exit': noProcessExitRule,
  'no-bare-date-now': noBareDateNowRule,
  'no-historical-comments': noHistoricalCommentsRule,
  'no-narration-comments': noNarrationCommentsRule,
  'no-pr-reference-comments': noPrReferenceCommentsRule,
  'no-focused-tests': noFocusedTestsRule,
  'skipped-tests-need-tracking': skippedTestsNeedTrackingRule,
  'no-vacuous-expect': noVacuousExpectRule,
  'no-conditional-expect': noConditionalExpectRule,
  'fake-timers-must-be-restored': fakeTimersMustBeRestoredRule,
  'no-real-network-in-unit-tests': noRealNetworkInUnitTestsRule,
  // Available but omitted from `recommended` (opinionated / niche).
  'interface-prefix-i': interfacePrefixIRule,
  'no-template-trim-empty-ternary': noTemplateTrimEmptyTernaryRule,
};
