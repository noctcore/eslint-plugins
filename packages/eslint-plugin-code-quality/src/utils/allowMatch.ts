/*
 * The glob matcher for the `allowIn` file-scope options, shared with the other
 * plugins through `@noctcore/eslint-utils`. Patterns are matched against
 * `context.filename` normalised to forward slashes, so a pattern such as
 * a globstar followed by `clock.ts` matches whether ESLint reports the file as
 * an absolute path or a project-relative one.
 */
export { matchesAnyGlob as matchesAny } from '@noctcore/eslint-utils';
