/**
 * Runs the rule tests against ESLint 9 instead of the pinned ESLint 10.
 *
 * Loaded with `NODE_OPTIONS=--import=@noctcore/eslint-test-utils/eslint9`
 * (see the root `test:eslint9` script). `@typescript-eslint/rule-tester` is
 * CommonJS and `require`s `eslint` from `node_modules`, where a Vite alias
 * never reaches, so the redirect is a Node resolve hook: it applies to
 * `require` and `import` alike, in the Vitest main process and its workers.
 *
 * The `eslint-v9` alias is pinned to 9.0.0, the floor of the `eslint >=9.0.0`
 * peer range every plugin declares.
 */
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve from this package, the one that depends on `eslint-v9`. The hook's
// `nextResolve` keeps the requiring module as the base for `require` calls, so
// it cannot see this package's `node_modules`.
const require = createRequire(import.meta.url);

process.env.NOCTCORE_ESLINT_MAJOR = '9';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'eslint' || specifier.startsWith('eslint/')) {
      const resolved = require.resolve(`eslint-v9${specifier.slice('eslint'.length)}`);
      return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
