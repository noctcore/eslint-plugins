import { ruleTester } from '@noctcore/eslint-test-utils';

import { fetchMustCheckOkRule } from '../../src/rules/fetch-must-check-ok';

const FILE = 'src/api.ts';

/*
 * The tsforge suite (packages/core/tests/rule-packs.test.ts, commit 75100ffd)
 * comes first in each list, case for case. Upstream asserted "contains a
 * report"; here every invalid case pins the exact count. Cases added in this
 * port follow the upstream ones.
 */
ruleTester.run('fetch-must-check-ok', fetchMustCheckOkRule, {
  valid: [
    // Allows a guard clause on res.ok.
    { code: 'async function load() { const res = await fetch("/api/users"); if (!res.ok) { throw new Error("failed"); } return res.json(); }', filename: FILE },
    // Allows a status comparison instead of ok.
    { code: 'async function load() { const res = await fetch("/api/users"); if (res.status !== 200) { return null; } return res.json(); }', filename: FILE },
    // Allows a then-callback that checks ok.
    { code: 'const data = fetch("/api/users").then((res) => (res.ok ? res.json() : null));', filename: FILE },
    // Allows an ok read bound to a variable and then tested.
    { code: 'async function load() { const res = await fetch("/api/users"); const ok = res.ok; if (!ok) { throw new Error("failed"); } return res.json(); }', filename: FILE },
    // Allows an assertion helper as the check.
    { code: 'async function load() { const res = await fetch("/api/users"); invariant(res.ok, "failed"); return res.json(); }', filename: FILE },
    // Allows assert.ok on the response.
    { code: 'async function load() { const res = await fetch("/api/users"); assert.ok(res.ok); return res.json(); }', filename: FILE },
    // Allows assert.equal on the status.
    { code: 'async function load() { const res = await fetch("/api/users"); assert.equal(res.status, 200); return res.json(); }', filename: FILE },
    // Allows a check in an enclosing function around the parse.
    { code: 'async function load() { const res = await fetch("/api/users"); if (!res.ok) { throw new Error("failed"); } return () => res.json(); }', filename: FILE },
    // Allows a short-circuit guard.
    { code: 'async function load() { const res = await fetch("/api/users"); return res.ok && res.json(); }', filename: FILE },
    // Allows a parse in the success branch of a check.
    { code: 'async function load() { const res = await fetch("/api/users"); if (res.ok) { return res.json(); } return null; }', filename: FILE },
    // Allows a parse in the else branch of a failure check.
    { code: 'async function load() { const res = await fetch("/api/users"); if (!res.ok) { return null; } else { return res.json(); } }', filename: FILE },
    // Allows a status comparison guard for a status alias.
    { code: 'async function load() { const res = await fetch("/api/users"); const code = res.status; if (code >= 400) { throw new Error("failed"); } return res.json(); }', filename: FILE },
    // Allows an or-short-circuit whose left side is the failure case.
    { code: 'async function load() { const res = await fetch("/api/users"); return !res.ok || res.json(); }', filename: FILE },
    // Allows a compound guard where either side means failure.
    { code: 'async function load() { const res = await fetch("/api/users"); if (aborted || !res.ok) { throw new Error("failed"); } return res.json(); }', filename: FILE },
    // Allows a status threshold below the error range.
    { code: 'async function load() { const res = await fetch("/api/users"); if (res.status < 400) { return res.json(); } return null; }', filename: FILE },
    // Allows a switch arm on a success code.
    { code: 'async function load() { const res = await fetch("/api/users"); switch (res.status) { case 200: return res.json(); default: return null; } }', filename: FILE },
    // Allows a switch body reached only by success codes.
    { code: 'async function load() { const res = await fetch("/api/users"); switch (res.status) { case 201: case 200: return res.json(); default: return null; } }', filename: FILE },
    // Allows a mirrored status comparison.
    { code: 'async function load() { const res = await fetch("/api/users"); if (400 > res.status) { return res.json(); } return null; }', filename: FILE },
    // Upstream's "allows an equality assertion against a success code" is
    // byte-identical to the case above; RuleTester rejects duplicates, so it
    // is kept once.
    // Allows an exiting guard where either operand means failure.
    { code: 'async function load() { const res = await fetch("/api/users"); if (!res.ok || force) { throw new Error("failed"); } return res.json(); }', filename: FILE },
    // Allows an exiting else whose test requires success.
    { code: 'async function load() { const res = await fetch("/api/users"); if (res.ok && enabled) { log(); } else { throw new Error("failed"); } return res.json(); }', filename: FILE },
    // Allows a complementary guard below the error boundary.
    { code: 'async function load() { const res = await fetch("/api/users"); if (res.status >= 300) { return null; } return res.json(); }', filename: FILE },
    // Allows a strict complementary guard below the error boundary.
    { code: 'async function load() { const res = await fetch("/api/users"); if (res.status > 350) { return null; } return res.json(); }', filename: FILE },
    // Ignores a response whose body is never parsed.
    { code: 'async function ping() { const res = await fetch("/api/health"); return res.text(); }', filename: FILE },

    // Added in this port.
    {
      // A guard clause inside a try, then a typed body read: the common
      // shape of a hand-written fetch helper.
      code: `
        export async function fetchProviders(): Promise<string[]> {
          try {
            const response = await fetch('/api/providers', { credentials: 'same-origin' });
            if (!response.ok) return [];
            const body: unknown = await response.json();
            return Array.isArray(body) ? body : [];
          } catch {
            return [];
          }
        }
      `,
      filename: FILE,
    },
    {
      // An async then-callback that throws on a bad response before parsing.
      code: `
        const token = fetch('/api/csrf').then(async (response) => {
          if (!response.ok) {
            throw new Error(\`csrf request failed with \${response.status}\`);
          }
          const data = (await response.json()) as { token?: unknown };
          return data.token;
        });
      `,
      filename: FILE,
    },
    {
      // A guard at the top governs a parse nested further down the same body.
      code: `
        async function load(wantBody: boolean) {
          const res = await fetch('/api/users');
          if (!res.ok) {
            throw new Error('failed');
          }
          if (wantBody) {
            return res.json();
          }
          return null;
        }
      `,
      filename: FILE,
    },
    {
      // Only configured callees produce a Response. Another client's result
      // is not tracked, and neither is a wrapper until it is configured.
      code: `
        async function load() {
          const a = await http.get('/api/users');
          const b = await fetchWithRetry('/api/users');
          return [await a.json(), await b.json()];
        }
      `,
      filename: FILE,
    },
    {
      // A configured wrapper is held to the same bar, and passes when checked.
      code: `
        async function load() {
          const res = await fetchWithRetry('/api/users');
          if (!res.ok) throw new Error('failed');
          return res.json();
        }
      `,
      filename: FILE,
      options: [{ fetchFunctions: ['fetch', 'fetchWithRetry'] }],
    },
  ],
  invalid: [
    {
      // Reports a bound response parsed without a check.
      code: 'async function load() { const res = await fetch("/api/users"); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an inline parse with no binding at all.
      code: 'async function load() { return (await fetch("/api/users")).json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a then-callback that parses without a check.
      code: 'const data = fetch("/api/users").then((res) => res.json());',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a check that only happens after the body is parsed.
      code: 'async function load() { const res = await fetch("/api/users"); const data = await res.json(); if (!res.ok) { throw new Error("failed"); } return data; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a status read that is recorded rather than acted on.
      code: 'async function load() { const res = await fetch("/api/users"); metrics.observe(res.status); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an ok read bound to a variable and never tested.
      code: 'async function load() { const res = await fetch("/api/users"); const ok = res.ok; log(ok); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a then-callback that parses before it checks.
      code: 'const data = fetch("/api/users").then((res) => { const body = res.json(); if (!res.ok) { throw new Error("failed"); } return body; });',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a helper whose name merely starts with an assertion word.
      code: 'async function load() { const res = await fetch("/api/users"); expectedStatus(res.status); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports when a nested function tests a shadowed alias name.
      code: 'async function load() { const res = await fetch("/api/users"); const ok = res.ok; function guard(ok: boolean) { if (!ok) { throw new Error("nope"); } } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports when only a nested function checks its own response.
      code: 'async function load() { const res = await fetch("/api/users"); function other(res: Response) { if (!res.ok) { throw new Error("nope"); } } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a check whose branch does not prevent the parse.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.ok) { metrics.hit(); } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a guard that only runs when another flag is set.
      code: 'async function load() { const res = await fetch("/api/users"); if (debug && !res.ok) { throw new Error("failed"); } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a bare truthiness test of the status.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.status) { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a typeof test of the status.
      code: 'async function load() { const res = await fetch("/api/users"); if (typeof res.status === "number") { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a second parse that the guard does not reach.
      code: 'async function load(preview: boolean) { const res = await fetch("/api/users"); if (preview) { if (!res.ok) { throw new Error("failed"); } return res.json(); } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a parse in the failure branch of a check.
      code: 'async function load() { const res = await fetch("/api/users"); if (!res.ok) { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a bare truthiness test of a status alias.
      code: 'async function load() { const res = await fetch("/api/users"); const code = res.status; if (code) { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an or-short-circuit, which parses on the failure path.
      code: 'async function load() { const res = await fetch("/api/users"); return res.ok || res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an or-short-circuit on a status comparison.
      code: 'async function load() { const res = await fetch("/api/users"); return res.status === 200 || res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a parse guarded by an explicit ok === false test.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.ok === false) { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a parse in the error branch of a status threshold.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.status >= 400) { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a truthiness assertion on the status.
      code: 'async function load() { const res = await fetch("/api/users"); assert.ok(res.status); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a single-code guard that lets every other error through.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.status === 404) { return null; } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a switch default arm that parses.
      code: 'async function load() { const res = await fetch("/api/users"); switch (res.status) { case 204: return null; default: return res.json(); } }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a then-branch that another operand can also enter.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.ok || force) { return res.json(); } return null; }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an else-branch reachable with the response still bad.
      code: 'async function load() { const res = await fetch("/api/users"); if (!res.ok && enabled) { return null; } else { return res.json(); } }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a threshold above the error boundary.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.status >= 500) { throw new Error("failed"); } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a truthiness assertion carrying a message argument.
      code: 'async function load() { const res = await fetch("/api/users"); assert.ok(res.status, "expected a status"); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports a switch body reachable by falling through an error code.
      code: 'async function load() { const res = await fetch("/api/users"); switch (res.status) { case 500: case 200: return res.json(); default: return null; } }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an equality assertion against an error code.
      code: 'async function load() { const res = await fetch("/api/users"); assert.equal(res.status, 404); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an exiting else whose test another operand can satisfy.
      code: 'async function load() { const res = await fetch("/api/users"); if (res.ok || force) { log(); } else { throw new Error("failed"); } return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },
    {
      // Reports an assertion another operand can satisfy.
      code: 'async function load() { const res = await fetch("/api/users"); assert(res.ok || force); return res.json(); }',
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck' }],
    },

    // Added in this port.
    {
      // A schema parse of an unchecked body: fails closed if wrapped in a
      // try, but an error body still reaches the schema as if it were data.
      code: `
        async function verify(token: string): Promise<boolean> {
          try {
            const response = await fetch('https://verify.example/api', { method: 'POST', body: token });
            const data = VerifySchema.parse(await response.json());
            return data.success;
          } catch {
            return false;
          }
        }
      `,
      filename: FILE,
      errors: [{ messageId: 'missingOkCheck', line: 5 }],
    },
    {
      // Every unguarded parse is its own report.
      code: `
        async function load() {
          const users = await fetch('/api/users');
          const teams = await fetch('/api/teams');
          return [await users.json(), await teams.json()];
        }
      `,
      filename: FILE,
      errors: [
        { messageId: 'missingOkCheck', line: 5, column: 25 },
        { messageId: 'missingOkCheck', line: 5, column: 45 },
      ],
    },
    {
      // fetchFunctions: a configured wrapper.
      code: `
        async function load() {
          const res = await fetchWithRetry('/api/users');
          return res.json();
        }
      `,
      filename: FILE,
      options: [{ fetchFunctions: ['fetch', 'fetchWithRetry'] }],
      errors: [{ messageId: 'missingOkCheck', line: 4 }],
    },
    {
      // fetchFunctions: a dotted callee path.
      code: `
        async function load() {
          return (await globalThis.fetch('/api/users')).json();
        }
      `,
      filename: FILE,
      options: [{ fetchFunctions: ['fetch', 'globalThis.fetch'] }],
      errors: [{ messageId: 'missingOkCheck', line: 3 }],
    },
  ],
});
