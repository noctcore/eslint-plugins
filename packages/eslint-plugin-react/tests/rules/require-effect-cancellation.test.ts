import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireEffectCancellationRule } from '../../src/rules/require-effect-cancellation';

const FILE = 'Widget.tsx';

ruleTester.run('require-effect-cancellation', requireEffectCancellationRule, {
  valid: [
    // No async step — a synchronous setState is not this rule's concern.
    {
      code: `useEffect(() => { setReady(true); }, []);`,
      filename: FILE,
    },
    // An await with no state update afterwards.
    {
      code: `useEffect(() => { async function ping() { await fetch(url); } ping(); }, [url]);`,
      filename: FILE,
    },
    // A `.then` with no setter inside the callback.
    {
      code: `useEffect(() => { fetch(url).then((r) => r.json()); }, [url]);`,
      filename: FILE,
    },
    // Guarded with an AbortController + cleanup return.
    {
      code: `useEffect(() => {
        const controller = new AbortController();
        async function load() { const d = await fetch(url, { signal: controller.signal }); setData(d); }
        load();
        return () => controller.abort();
      }, [url]);`,
      filename: FILE,
    },
    // Guarded with a cancelled flag checked before the update.
    {
      code: `useEffect(() => {
        let cancelled = false;
        load().then((d) => { if (!cancelled) setData(d); });
        return () => { cancelled = true; };
      }, []);`,
      filename: FILE,
    },
  ],
  invalid: [
    // await shape, no guard.
    {
      code: `useEffect(() => {
        async function load() { const d = await fetchThing(id); setData(d); }
        load();
      }, [id]);`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation' }],
    },
    // `.then` shape, no guard.
    {
      code: `useEffect(() => { fetchThing(id).then((d) => setData(d)); }, [id]);`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation' }],
    },
    // dispatch after await, no guard.
    {
      code: `useEffect(() => {
        (async () => { const d = await load(); dispatch({ type: 'set', payload: d }); })();
      }, []);`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation' }],
    },
  ],
});
