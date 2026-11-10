import { ruleTester } from '@noctcore/eslint-test-utils';

import { noErrorStringifyRule } from '../../src/rules/no-error-stringify';

ruleTester.run('no-error-stringify', noErrorStringifyRule, {
  valid: [
    // The guarded extractor idiom is the intended pattern and stays legal.
    {
      code: 'const msg = error instanceof Error ? error.message : String(error);',
    },
    { code: 'logger.error("failed", error instanceof Error ? error.stack : String(error));' },
    // Member access, not stringify.
    { code: 'const m = `${error.message}`;' },
    // Bare String(error) is intentionally not policed (guarded idiom uses it).
    { code: 'const s = String(error);' },
    { code: 'const total = count + "";' },
    // Custom identifier set: `error` is no longer treated as an error name.
    {
      code: 'const msg = `${error}`;',
      options: [{ errorIdentifierNames: ['cause'] }],
    },
    // Short names that are not bound by a catch are not errors.
    { code: 'const widths = sizes.map((e) => `${e}px`);' },
    { code: 'function explain(cause: string) { return `because ${cause}`; }' },
    // The first callback of then is the success handler.
    { code: 'load().then((e) => `${e}`);' },
    // Inside a logger call's arguments, observability no-error-detail-loss owns
    // the line (it asks for the error object), so this rule stays silent.
    { code: 'logger.error(`request failed: ${error}`);' },
    { code: 'this.logger.warn("failed: " + err.toString());' },
    { code: 'try { run(); } catch (e) { console.error(`boom ${e}`, { at: Date.now() }); }' },
    { code: 'audit.error(`failed: ${error}`);', options: [{ loggers: ['audit'] }] },
  ],
  invalid: [
    // Outside a logger call, and in a callback passed to a logger (another function), it still reports.
    {
      code: 'logger.error(`x`, () => `${error}`);',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'logger.error(`x`, () => `${error instanceof Error ? error.message : String(error)}`);' }] }],
    },
    {
      code: 'audit.error(`failed: ${error}`);',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'audit.error(`failed: ${error instanceof Error ? error.message : String(error)}`);' }] }],
    },
    // checkLoggerArguments puts logger arguments back in scope.
    {
      code: 'logger.error(`request failed: ${error}`);',
      options: [{ checkLoggerArguments: true }],
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'logger.error(`request failed: ${error instanceof Error ? error.message : String(error)}`);' }] }],
    },
    {
      code: 'const msg = err.toString();',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'const msg = (err instanceof Error ? err.message : String(err));' }] }],
    },
    {
      code: 'const msg = error + "";',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'const msg = (error instanceof Error ? error.message : String(error));' }] }],
    },
    // A short name counts when a catch clause binds it.
    {
      code: 'try { run(); } catch (e) { log("" + e); }',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'try { run(); } catch (e) { log((e instanceof Error ? e.message : String(e))); }' }] }],
    },
    // Any name bound by a rejection handler counts.
    {
      code: 'load().catch((cause) => log(`failed: ${cause}`));',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'load().catch((cause) => log(`failed: ${cause instanceof Error ? cause.message : String(cause)}`));' }] }],
    },
    {
      code: 'load().then(render, (problem) => log(problem.toString()));',
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'load().then(render, (problem) => log((problem instanceof Error ? problem.message : String(problem))));' }] }],
    },
    // Custom identifier set flags a name the default would miss.
    {
      code: 'const msg = `${failure}`;',
      options: [{ errorIdentifierNames: ['failure'] }],
      errors: [{ messageId: 'noErrorStringify', suggestions: [{ messageId: 'useMessage', output: 'const msg = `${failure instanceof Error ? failure.message : String(failure)}`;' }] }],
    },
  ],
});
