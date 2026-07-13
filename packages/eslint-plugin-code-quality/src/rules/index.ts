import { interfacePrefixIRule } from './interface-prefix-i';
import { noBareDateNowRule } from './no-bare-date-now';
import { noFocusedTestsRule } from './no-focused-tests';
import { noHistoricalCommentsRule } from './no-historical-comments';
import { noNarrationCommentsRule } from './no-narration-comments';
import { noPrReferenceCommentsRule } from './no-pr-reference-comments';
import { noProcessExitRule } from './no-process-exit';
import { noTemplateTrimEmptyTernaryRule } from './no-template-trim-empty-ternary';
import { preferEarlyReturnRule } from './prefer-early-return';
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
  // Available but omitted from `recommended` (opinionated / niche).
  'interface-prefix-i': interfacePrefixIRule,
  'no-template-trim-empty-ternary': noTemplateTrimEmptyTernaryRule,
};
