import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireErrorCauseRule } from '../../src/rules/require-error-cause';

const FILE = 'src/service.ts';

ruleTester.run('require-error-cause', requireErrorCauseRule, {
  valid: [
    // Cause already forwarded.
    {
      code: `try { work(); } catch (err) { throw new Error('failed', { cause: err }); }`,
      filename: FILE,
    },
    // Any cause value satisfies the rule (never second-guess a hand-written cause).
    {
      code: `try { work(); } catch (err) { throw new AppError('failed', { cause: original }); }`,
      filename: FILE,
    },
    // Bare re-throw is not a NewExpression.
    {
      code: `try { work(); } catch (err) { throw err; }`,
      filename: FILE,
    },
    // `throw new` outside any catch is out of scope.
    {
      code: `throw new Error('boom');`,
      filename: FILE,
    },
    // Parameterless catch has no binding to reference.
    {
      code: `try { work(); } catch { throw new Error('boom'); }`,
      filename: FILE,
    },
    // Destructured catch binding has no single name to reference.
    {
      code: `try { work(); } catch ({ message }) { throw new Error('boom'); }`,
      filename: FILE,
    },
    // Non-error-named constructor is not policed.
    {
      code: `try { work(); } catch (err) { throw new Response('nope'); }`,
      filename: FILE,
    },
    // Spread argument object may already carry a cause — left alone.
    {
      code: `try { work(); } catch (err) { throw new Error('failed', { ...opts }); }`,
      filename: FILE,
    },
  ],
  invalid: [
    // One message arg: append a new options object.
    {
      code: `try { work(); } catch (err) { throw new Error('failed'); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: `try { work(); } catch (err) { throw new Error('failed', { cause: err }); }`,
    },
    // Existing non-empty options object: merge cause in.
    {
      code: `try { work(); } catch (err) { throw new HttpError('failed', { status: 500 }); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: `try { work(); } catch (err) { throw new HttpError('failed', { status: 500, cause: err }); }`,
    },
    // Empty options object: fill it.
    {
      code: `try { work(); } catch (err) { throw new ValidationError('bad', {}); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: `try { work(); } catch (err) { throw new ValidationError('bad', { cause: err }); }`,
    },
    // Member-expression constructor.
    {
      code: `try { work(); } catch (err) { throw new errors.AppError('failed'); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: `try { work(); } catch (err) { throw new errors.AppError('failed', { cause: err }); }`,
    },
    // Zero-argument constructor: reported, but declined for autofix (no positional message to preserve).
    {
      code: `try { work(); } catch (err) { throw new Error(); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: null,
    },
    // Throw nested in a closure declared inside the catch still sees the binding.
    {
      code: `try { work(); } catch (err) { [1].forEach(() => { throw new Error('inner'); }); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: `try { work(); } catch (err) { [1].forEach(() => { throw new Error('inner', { cause: err }); }); }`,
    },
    // Nested try/catch: the nearest (inner) binding is attached.
    {
      code: `try { a(); } catch (outer) { try { b(); } catch (inner) { throw new Error('x'); } }`,
      filename: FILE,
      errors: [{ messageId: 'missingCause' }],
      output: `try { a(); } catch (outer) { try { b(); } catch (inner) { throw new Error('x', { cause: inner }); } }`,
    },
  ],
});
