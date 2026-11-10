/*
 * Layout-independent helpers for this package's async-safety rules. The shared
 * RuleTester is NOT type-aware, so every rule here is high-precision syntactic;
 * these helpers are the AST plumbing that makes that possible.
 */

// Callee paths are shared with the other plugins through @noctcore/eslint-utils;
// re-exported under the name these rules already use.
export { calleePath as calleeText } from '@noctcore/eslint-utils';
