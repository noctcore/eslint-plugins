/*
 * The glob matcher for module specifiers and type names (`clockModules`,
 * `sharedSuiteModules`, `allowTargets`), shared with the other plugins through
 * `@noctcore/eslint-utils`. File-scope options such as `allowIn` use
 * `fileMatchesAnyGlob` instead, which also tries the cwd- and root-relative path.
 */
export { matchesAnyGlob as matchesAny } from '@noctcore/eslint-utils';
