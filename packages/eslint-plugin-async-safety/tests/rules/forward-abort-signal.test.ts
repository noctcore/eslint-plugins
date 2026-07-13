import { ruleTester } from '@noctcore/eslint-test-utils';

import { forwardAbortSignalRule } from '../../src/rules/forward-abort-signal';

ruleTester.run('forward-abort-signal', forwardAbortSignalRule, {
  valid: [
    // Forwarded into a fetch options object.
    {
      code: `async function load(url: string, signal: AbortSignal) { return await fetch(url, { signal }); }`,
    },
    // Forwarded as a direct call argument.
    { code: `async function run(signal: AbortSignal) { await doThing(signal); }` },
    // Destructured signal, forwarded.
    { code: `async function load({ signal }: Opts) { return await fetch('x', { signal }); }` },
    // Renamed but forwarded.
    { code: `async function run(sig: AbortSignal) { await go({ signal: sig }); }` },
    // No cancellable work in the body — nothing to forward to.
    { code: `function check(signal: AbortSignal) { return signal.aborted; }` },
    // No signal parameter at all.
    { code: `async function run() { await fetch('x'); }` },
    // Arrow form, forwarded.
    { code: `const load = async (signal: AbortSignal) => { await fetch('x', { signal }); };` },
    // Forwarded from inside a nested callback.
    {
      code: `async function all(signal: AbortSignal, urls: string[]) { await Promise.all(urls.map((u) => fetch(u, { signal }))); }`,
    },
  ],
  invalid: [
    // Awaits fetch but drops the signal.
    {
      code: `async function load(url: string, signal: AbortSignal) { return await fetch(url); }`,
      errors: [{ messageId: 'unforwardedSignal', data: { name: 'signal' } }],
    },
    // Signal used only for an `.aborted` check.
    {
      code: `async function load(signal: AbortSignal) { if (signal.aborted) return; return await fetch('x'); }`,
      errors: [{ messageId: 'unforwardedSignal', data: { name: 'signal' } }],
    },
    // Parameter named `signal`, untyped.
    {
      code: `async function load(signal) { await doWork(); }`,
      errors: [{ messageId: 'unforwardedSignal', data: { name: 'signal' } }],
    },
    // Destructured, checked but not forwarded.
    {
      code: `async function run({ signal }: Opts) { if (signal.aborted) return; await doWork(); }`,
      errors: [{ messageId: 'unforwardedSignal', data: { name: 'signal' } }],
    },
    // Renamed typed signal, not forwarded.
    {
      code: `async function run(sig: AbortSignal) { await doWork(); }`,
      errors: [{ messageId: 'unforwardedSignal', data: { name: 'sig' } }],
    },
    // Arrow form, not forwarded.
    {
      code: `const load = async (signal: AbortSignal) => { await fetch('x'); };`,
      errors: [{ messageId: 'unforwardedSignal', data: { name: 'signal' } }],
    },
  ],
});
