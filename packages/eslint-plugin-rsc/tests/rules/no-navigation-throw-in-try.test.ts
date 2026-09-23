import { ruleTester } from '@noctcore/eslint-test-utils';

import { noNavigationThrowInTryRule } from '../../src/rules/no-navigation-throw-in-try';

const TS = 'app/page.tsx';
const NAV = `import { redirect, notFound, unstable_rethrow } from 'next/navigation';\n`;

ruleTester.run('no-navigation-throw-in-try', noNavigationThrowInTryRule, {
  valid: [
    // Outside any try.
    { code: `${NAV}export async function Page() { const u = await load(); if (!u) notFound(); redirect('/home'); }`, filename: TS },
    // After the try, the documented fix.
    {
      code: `${NAV}async function f() { let ok; try { ok = await save(); } catch (e) { ok = false; } if (ok) redirect('/done'); }`,
      filename: TS,
    },
    // try/finally without a catch: the error still propagates.
    { code: `${NAV}function f() { try { redirect('/x'); } finally { cleanup(); } }`, filename: TS },
    // unstable_rethrow(e) first in the catch.
    {
      code: `${NAV}function f() { try { redirect('/x'); } catch (e) { unstable_rethrow(e); log(e); } }`,
      filename: TS,
    },
    // unstable_rethrow imported under an alias, after a log line.
    {
      code: `import { redirect, unstable_rethrow as rethrow } from 'next/navigation';\nfunction f() { try { redirect('/x'); } catch (err) { console.error(err); rethrow(err); } }`,
      filename: TS,
    },
    // An unconditional rethrow of the caught error.
    { code: `${NAV}function f() { try { notFound(); } catch (e) { log(e); throw e; } }`, filename: TS },
    // A guarded rethrow of the caught error (the isRedirectError pattern).
    {
      code: `${NAV}function f() { try { redirect('/x'); } catch (e) { if (isRedirectError(e)) throw e; return null; } }`,
      filename: TS,
    },
    // Rethrow through a type assertion.
    { code: `${NAV}function f() { try { redirect('/x'); } catch (e) { throw e as Error; } }`, filename: TS },
    // A same-named local function, not the Next.js export.
    { code: `function redirect(to: string) {}\nfunction f() { try { redirect('/x'); } catch {} }`, filename: TS },
    // A same-named import from another module.
    { code: `import { redirect } from '@remix-run/node';\nfunction f() { try { redirect('/x'); } catch {} }`, filename: TS },
    // A local that shadows the import.
    {
      code: `${NAV}function f(redirect: (to: string) => void) { try { redirect('/x'); } catch {} }`,
      filename: TS,
    },
    // A nested function defined, not run, in the try.
    {
      code: `${NAV}function f() { try { const go = () => redirect('/x'); register(go); } catch {} }`,
      filename: TS,
    },
    {
      code: `${NAV}function f() { try { items.forEach(function (i) { if (!i) notFound(); }); } catch {} }`,
      filename: TS,
    },
    // Inside the catch: thrown out of the catch, nothing swallows it.
    { code: `${NAV}async function f() { try { await save(); } catch { redirect('/error'); } }`, filename: TS },
    // Inside the finally.
    { code: `${NAV}function f() { try { save(); } catch {} finally { redirect('/x'); } }`, filename: TS },
    // A next/navigation export that does not throw.
    {
      code: `import { useRouter } from 'next/navigation';\nfunction f() { try { useRouter(); } catch {} }`,
      filename: TS,
    },
    // Namespace import, rethrown.
    {
      code: `import * as nav from 'next/navigation';\nfunction f() { try { nav.redirect('/x'); } catch (e) { nav.unstable_rethrow(e); } }`,
      filename: TS,
    },
  ],
  invalid: [
    // The canonical bug: the catch swallows the redirect.
    {
      code: `${NAV}async function action() { try { await save(); redirect('/done'); } catch (e) { return { error: 'failed' }; } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry', data: { name: 'redirect', param: 'e' } }],
    },
    // Optional catch binding.
    {
      code: `${NAV}function f() { try { notFound(); } catch { return null; } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry', data: { name: 'notFound', param: 'error' } }],
    },
    // Aliased import.
    {
      code: `import { permanentRedirect as go } from 'next/navigation';\nfunction f() { try { go('/x'); } catch (e) { log(e); } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry', data: { name: 'permanentRedirect', param: 'e' } }],
    },
    // forbidden and unauthorized.
    {
      code: `import { forbidden, unauthorized } from 'next/navigation';\nfunction f(u) { try { if (!u) unauthorized(); if (!u.admin) forbidden(); } catch (e) {} }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }, { messageId: 'navigationThrowInTry' }],
    },
    // Namespace import.
    {
      code: `import * as nav from 'next/navigation';\nfunction f() { try { nav.redirect('/x'); } catch (e) {} }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry', data: { name: 'redirect', param: 'e' } }],
    },
    // A wrapped rethrow is not the error Next.js threw.
    {
      code: `${NAV}function f() { try { redirect('/x'); } catch (e) { throw new Error('failed', { cause: e }); } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }],
    },
    // unstable_rethrow of something other than the caught error.
    {
      code: `${NAV}function f(other) { try { redirect('/x'); } catch (e) { unstable_rethrow(other); } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }],
    },
    // A same-named unstable_rethrow that is not the Next.js export.
    {
      code: `import { redirect } from 'next/navigation';\nfunction unstable_rethrow(e) {}\nfunction f() { try { redirect('/x'); } catch (e) { unstable_rethrow(e); } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }],
    },
    // A rethrow inside a nested callback does not rethrow from the catch.
    {
      code: `${NAV}function f() { try { redirect('/x'); } catch (e) { setTimeout(() => { throw e; }); } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }],
    },
    // The inner catch rethrows, the outer one swallows.
    {
      code: `${NAV}function f() { try { try { redirect('/x'); } catch (e) { throw e; } } catch (e) { return null; } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }],
    },
    // Nested inside a block, a loop and an if in the try.
    {
      code: `${NAV}function f(xs) { try { for (const x of xs) { if (!x) { notFound(); } } } catch (e) { report(e); } }`,
      filename: TS,
      errors: [{ messageId: 'navigationThrowInTry' }],
    },
  ],
});
