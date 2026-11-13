import { ruleTester } from '@noctcore/eslint-test-utils';

import { prefixQueryKeyMustUseSetQueriesDataRule } from '../../src/rules/prefix-query-key-must-use-set-queries-data';

const HOOK = 'useQuery({ queryKey: [...TODOS, id], queryFn });';

const setSuggestion = (output: string) => [
  { messageId: 'prefixKey' as const, suggestions: [{ messageId: 'useSetQueriesData' as const, output }] },
];
const getSuggestion = (output: string) => [
  { messageId: 'prefixKey' as const, suggestions: [{ messageId: 'useGetQueriesData' as const, output }] },
];

ruleTester.run('prefix-query-key-must-use-set-queries-data', prefixQueryKeyMustUseSetQueriesDataRule, {
  valid: [
    {
      // The bare prefix is itself a query key, so the exact-key call is right.
      code: `
        useQuery({ queryKey: TODOS, queryFn });
        useQuery({ queryKey: [...TODOS, id], queryFn });
        queryClient.setQueryData(TODOS, list);
      `,
    },
    { code: `${HOOK}\nqueryClient.cancelQueries({ queryKey: TODOS });` },
    { code: `${HOOK}\nqueryClient.removeQueries({ queryKey: TODOS });` },
    { code: `${HOOK}\nqueryClient.resetQueries({ queryKey: TODOS });` },
    { code: `${HOOK}\nqueryClient.invalidateQueries({ queryKey: TODOS });` },
    { code: `${HOOK}\nqueryClient.setQueriesData({ queryKey: TODOS }, updater);` },
    { code: `${HOOK}\nqueryClient.getQueriesData({ queryKey: TODOS });` },
    { code: `${HOOK}\nqueryClient.setQueryData([...TODOS, id], data);` },
    { code: `${HOOK}\nqueryClient.setQueryData(OTHER, data);` },
    { code: 'queryClient.setQueryData(TODOS, list);' },
    { code: 'useQuery({ queryKey: [...TODOS], queryFn });\nqueryClient.setQueryData(TODOS, list);' },
    { code: 'useQuery({ queryKey: [...TODOS[0], id], queryFn });\nqueryClient.setQueryData(TODOS, list);' },
    { code: 'useMutation({ queryKey: [...TODOS, id] });\nqueryClient.setQueryData(TODOS, list);' },
    {
      code: `${HOOK}\nqueryClient.getQueryData(TODOS);`,
      options: [{ methods: ['setQueryData'] }],
    },
  ],
  invalid: [
    {
      code: `${HOOK}\nqueryClient.setQueryData(TODOS, list);`,
      errors: [
        {
          messageId: 'prefixKey',
          suggestions: [
            {
              messageId: 'useSetQueriesData',
              output: `${HOOK}\nqueryClient.setQueriesData({ queryKey: TODOS }, list);`,
            },
          ],
        },
      ],
    },
    {
      code: `${HOOK}\nqueryClient.getQueryData(TODOS);`,
      errors: [
        {
          messageId: 'prefixKey',
          suggestions: [
            {
              messageId: 'useGetQueriesData',
              output: `${HOOK}\nqueryClient.getQueriesData({ queryKey: TODOS });`,
            },
          ],
        },
      ],
    },
    {
      // The call comes before the hook in the file.
      code: `queryClient.setQueryData(TODOS, list);\n${HOOK}`,
      errors: [
        {
          messageId: 'prefixKey',
          suggestions: [
            {
              messageId: 'useSetQueriesData',
              output: `queryClient.setQueriesData({ queryKey: TODOS }, list);\n${HOOK}`,
            },
          ],
        },
      ],
    },
    {
      code: `
        useInfiniteQuery({ queryKey: [...keys.todos, filter], queryFn });
        client.setQueryData(keys.todos, (old) => old, { updatedAt: 1 });
      `,
      errors: [
        {
          messageId: 'prefixKey',
          suggestions: [
            {
              messageId: 'useSetQueriesData',
              output: `
        useInfiniteQuery({ queryKey: [...keys.todos, filter], queryFn });
        client.setQueriesData({ queryKey: keys.todos }, (old) => old, { updatedAt: 1 });
      `,
            },
          ],
        },
      ],
    },
    {
      code: `
        export const opts = queryOptions({ queryKey: [...TODOS, id], queryFn });
        useQueryClient().getQueryData(TODOS as const);
      `,
      errors: [
        {
          messageId: 'prefixKey',
          suggestions: [
            {
              messageId: 'useGetQueriesData',
              output: `
        export const opts = queryOptions({ queryKey: [...TODOS, id], queryFn });
        useQueryClient().getQueriesData({ queryKey: TODOS });
      `,
            },
          ],
        },
      ],
    },
    {
      code: `
        useSuspenseQuery({ queryKey: [...TODOS, id], queryFn });
        useSuspenseInfiniteQuery({ queryKey: [...TODOS, 'x'], queryFn });
        queryClient.setQueryData(TODOS, a);
        queryClient.getQueryData(TODOS);
      `,
      errors: [
        ...setSuggestion(`
        useSuspenseQuery({ queryKey: [...TODOS, id], queryFn });
        useSuspenseInfiniteQuery({ queryKey: [...TODOS, 'x'], queryFn });
        queryClient.setQueriesData({ queryKey: TODOS }, a);
        queryClient.getQueryData(TODOS);
      `),
        ...getSuggestion(`
        useSuspenseQuery({ queryKey: [...TODOS, id], queryFn });
        useSuspenseInfiniteQuery({ queryKey: [...TODOS, 'x'], queryFn });
        queryClient.setQueryData(TODOS, a);
        queryClient.getQueriesData({ queryKey: TODOS });
      `),
      ],
    },
    {
      // A bare key for a different prefix does not silence this one.
      code: `
        useQuery({ queryKey: OTHER, queryFn });
        ${HOOK}
        queryClient.setQueryData(TODOS, list);
      `,
      errors: setSuggestion(`
        useQuery({ queryKey: OTHER, queryFn });
        ${HOOK}
        queryClient.setQueriesData({ queryKey: TODOS }, list);
      `),
    },
    {
      // A filter use of the bare prefix does not count as a query key.
      code: `${HOOK}\nqueryClient.invalidateQueries({ queryKey: TODOS });\nqueryClient.setQueryData(TODOS, list);`,
      errors: setSuggestion(
        `${HOOK}\nqueryClient.invalidateQueries({ queryKey: TODOS });\nqueryClient.setQueriesData({ queryKey: TODOS }, list);`,
      ),
    },
    {
      code: `useAppQuery({ queryKey: [...TODOS, id], queryFn });\nqueryClient.setQueryData(TODOS, list);`,
      options: [{ queryHooks: ['useAppQuery'] }],
      errors: setSuggestion(
        `useAppQuery({ queryKey: [...TODOS, id], queryFn });\nqueryClient.setQueriesData({ queryKey: TODOS }, list);`,
      ),
    },
    {
      // A method with no plural form is reported without a suggestion.
      code: `${HOOK}\nqueryClient.ensureQueryData(TODOS);`,
      options: [{ methods: ['ensureQueryData'] }],
      errors: [{ messageId: 'prefixKey', suggestions: [] }],
    },
    {
      // `methods` replaces the defaults.
      code: `${HOOK}\nqueryClient.setQueryData(TODOS, list);\nqueryClient.getQueryData(TODOS);`,
      options: [{ methods: ['getQueryData'] }],
      errors: [
        {
          messageId: 'prefixKey',
          line: 3,
          suggestions: [
            {
              messageId: 'useGetQueriesData',
              output: `${HOOK}\nqueryClient.setQueryData(TODOS, list);\nqueryClient.getQueriesData({ queryKey: TODOS });`,
            },
          ],
        },
      ],
    },
  ],
});
