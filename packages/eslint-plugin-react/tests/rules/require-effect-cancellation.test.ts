import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireEffectCancellationRule } from '../../src/rules/require-effect-cancellation';

const FILE = 'Widget.tsx';

ruleTester.run('require-effect-cancellation', requireEffectCancellationRule, {
  valid: [
    // No async step — a synchronous setState is not this rule's concern.
    {
      code: `function C() { const [ready, setReady] = useState(false); useEffect(() => { setReady(true); }, []); }`,
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
      code: `function C({ url }) {
        const [data, setData] = useState(null);
        useEffect(() => {
          const controller = new AbortController();
          async function load() { const d = await fetch(url, { signal: controller.signal }); setData(d); }
          load();
          return () => controller.abort();
        }, [url]);
      }`,
      filename: FILE,
    },
    // Guarded with a cancelled flag checked before the update.
    {
      code: `function C() {
        const [data, setData] = useState(null);
        useEffect(() => {
          let cancelled = false;
          load().then((d) => { if (!cancelled) setData(d); });
          return () => { cancelled = true; };
        }, []);
      }`,
      filename: FILE,
    },
    // A timer after an async step is not a state update.
    {
      code: `function C() { useEffect(() => { (async () => { await load(); setTimeout(tick, 100); })(); }, []); }`,
      filename: FILE,
    },
    // A setter from a context hook is not this component's state.
    {
      code: `function C({ id }) { const { setUser } = useAuth(); useEffect(() => { fetchUser(id).then((u) => setUser(u)); }, [id]); }`,
      filename: FILE,
    },
    // A cleanup that flips a ref, or a returned value the rule cannot see into.
    {
      code: `function C() {
        const [data, setData] = useState(null);
        const live = useRef(true);
        useEffect(() => {
          load().then((d) => setData(d));
          return () => { live.current = false; };
        }, []);
      }`,
      filename: FILE,
    },
    {
      code: `function C() {
        const [data, setData] = useState(null);
        useEffect(() => {
          const unsubscribe = feed.subscribe((d) => setData(d));
          load().then((d) => setData(d));
          return unsubscribe;
        }, []);
      }`,
      filename: FILE,
    },
    // A cleanup that calls a cancel method counts.
    {
      code: `function C() {
        const [data, setData] = useState(null);
        useEffect(() => {
          const request = client.get('/me');
          request.then((d) => setData(d));
          return () => request.cancel();
        }, []);
      }`,
      filename: FILE,
    },
  ],
  invalid: [
    // A cleanup that only clears a timer or a listener does not cancel the fetch.
    {
      code: `function C() {
        const [data, setData] = useState(null);
        useEffect(() => {
          const id = setInterval(poll, 1000);
          load().then((d) => setData(d));
          return () => clearInterval(id);
        }, []);
      }`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation', line: 5 }],
    },
    {
      code: `function C() {
        const [width, setWidth] = useState(0);
        useEffect(() => {
          const onResize = () => setWidth(window.innerWidth);
          window.addEventListener('resize', onResize);
          (async () => {
            const size = await measure();
            setWidth(size);
          })();
          return () => {
            window.removeEventListener('resize', onResize);
          };
        }, []);
      }`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation', line: 8 }],
    },
    // await shape, no guard.
    {
      code: `function C({ id }) {
        const [data, setData] = useState(null);
        useEffect(() => {
          async function load() { const d = await fetchThing(id); setData(d); }
          load();
        }, [id]);
      }`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation' }],
    },
    // `.then` shape, no guard.
    {
      code: `function C({ id }) { const [data, setData] = React.useState(null); useEffect(() => { fetchThing(id).then((d) => setData(d)); }, [id]); }`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation' }],
    },
    // dispatch after await, no guard.
    {
      code: `function C() {
        const [state, dispatch] = useReducer(reducer, init);
        useEffect(() => {
          (async () => { const d = await load(); dispatch({ type: 'set', payload: d }); })();
        }, []);
      }`,
      filename: FILE,
      errors: [{ messageId: 'missingCancellation' }],
    },
  ],
});
