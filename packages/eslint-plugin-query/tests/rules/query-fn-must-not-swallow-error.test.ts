import { ruleTester } from '@noctcore/eslint-test-utils';

import { queryFnMustNotSwallowErrorRule } from '../../src/rules/query-fn-must-not-swallow-error';

const catchReturn = [{ messageId: 'catchReturnsValue' as const }];
const handlerReturn = [{ messageId: 'catchHandlerReturnsValue' as const }];

const swallowing = 'async () => { try { return await api.me(); } catch { return null; } }';

ruleTester.run('query-fn-must-not-swallow-error', queryFnMustNotSwallowErrorRule, {
  valid: [
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { throw toAppError(e); } } });',
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { console.error(e); throw e; } } });',
    },
    { code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch { return; } } });' },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch { return undefined; } } });',
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch { return void 0; } } });',
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { return Promise.reject(e); } } });',
    },
    { code: 'useQuery({ queryKey, queryFn: () => api.me().catch((e) => Promise.reject(e)) });' },
    {
      code: 'useQuery({ queryKey, queryFn: () => api.me().catch((e) => { throw toAppError(e); }) });',
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { const f = () => null; throw e; } } });',
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { items.map(() => { return null; }); throw e; } } });',
    },
    { code: 'useQuery({ queryKey, queryFn: () => api.me().catch(handleError) });' },
    {
      code: `
        async function fetchMe() { try { return await api.me(); } catch { return null; } }
        useQuery({ queryKey, queryFn: fetchMe });
      `,
    },
    { code: 'useQuery({ queryKey, queryFn: () => loadMe() });' },
    {
      code: 'useQuery({ queryKey, select: () => { try { return a(); } catch { return null; } } });',
    },
    { code: 'async function load() { try { return await api.me(); } catch { return null; } }' },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            // allow-silent: optional profile
            return null;
          }
        },
      });`,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            /* allow-silent: optional */
            return null;
          }
        },
      });`,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: () =>
          api
            .me()
            // allow-silent: optional profile
            .catch(() => null),
      });`,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            // swallow-ok: optional profile
            return null;
          }
        },
      });`,
      options: [{ allowComment: 'swallow-ok' }],
    },
    {
      code: `useQuery({ queryKey, queryFn: ${swallowing} });`,
      options: [{ queryFnProperties: ['loader'] }],
    },
  ],
  invalid: [
    {
      code: `useQuery({ queryKey, queryFn: ${swallowing} });`,
      errors: catchReturn,
    },
    {
      code: `useInfiniteQuery({ queryKey, queryFn: ${swallowing} });`,
      errors: catchReturn,
    },
    {
      code: `useSuspenseQuery({ queryKey, queryFn: ${swallowing} });`,
      errors: catchReturn,
    },
    {
      code: `useSuspenseInfiniteQuery({ queryKey, queryFn: ${swallowing} });`,
      errors: catchReturn,
    },
    {
      code: `queryOptions({ queryKey, queryFn: ${swallowing} });`,
      errors: catchReturn,
    },
    {
      code: `useQueries({ queries: [{ queryKey: A, queryFn }, { queryKey: B, queryFn: ${swallowing} }] });`,
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.list(); } catch { return []; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch { return {}; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { return e; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch { return null as never; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn() { try { return api.me(); } catch { return null; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async function () { try { return await api.me(); } catch { return null; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch (e) { if (x) return null; throw e; } } });',
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { try { return await api.me(); } catch { try { return await api.retry(); } catch { return null; } } } });',
      errors: [...catchReturn, ...catchReturn],
    },
    {
      code: 'useQuery({ queryKey, queryFn: () => api.me().catch(() => null) });',
      errors: handlerReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: () => api.me().catch((e) => { return []; }) });',
      errors: handlerReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { return api.me().catch(() => null); } });',
      errors: handlerReturn,
    },
    {
      code: 'useQuery({ queryKey, queryFn: async () => { return await api.me().catch(() => ({})); } });',
      errors: handlerReturn,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            // allow-silent:
            return null;
          }
        },
      });`,
      errors: catchReturn,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            // allow-silent:   
            return null;
          }
        },
      });`,
      errors: catchReturn,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            // allow-silent: optional profile

            return null;
          }
        },
      });`,
      errors: catchReturn,
    },
    {
      code: `useQuery({
        queryKey,
        queryFn: async () => {
          try {
            return await api.me();
          } catch {
            // allow-silent: optional profile
            return null;
          }
        },
      });`,
      options: [{ allowComment: 'swallow-ok' }],
      errors: catchReturn,
    },
    {
      code: 'useQuery({ queryKey, loader: async () => { try { return await api.me(); } catch { return null; } } });',
      options: [{ queryFnProperties: ['loader'] }],
      errors: catchReturn,
    },
    {
      code: `useQueries({ queries: [{ queryKey: A, loader: ${swallowing} }] });`,
      options: [{ queryFnProperties: ['loader'] }],
      errors: catchReturn,
    },
  ],
});
