import { ruleTester } from '@noctcore/eslint-test-utils';

import { queryKeyMustBeConstantRule } from '../../src/rules/query-key-must-be-constant';

const inline = [{ messageId: 'inlineKey' as const }];

ruleTester.run('query-key-must-be-constant', queryKeyMustBeConstantRule, {
  valid: [
    { code: 'useQuery({ queryKey: USER_KEYS.me, queryFn });' },
    { code: 'useQuery({ queryKey: userKeys.detail(id), queryFn });' },
    { code: 'useQuery({ queryKey: [...USER_KEYS.all, id], queryFn });' },
    { code: 'useQuery({ queryKey: [USER, id], queryFn });' },
    {
      // A key factory definition is not an argument of a matched call.
      code: "const userKeys = { all: ['user'] as const, detail: (id: string) => ['user', id] as const };",
    },
    { code: 'queryClient.invalidateQueries({ queryKey: trpc.post.list.pathKey() });' },
    { code: "useQueries({ queries: [{ queryKey: USER, queryFn }] });" },
    {
      // Not a default client method.
      code: "queryClient.cancelQueries({ queryKey: ['user'] });",
    },
    {
      code: "useQuery({ queryKey: ['user', id], queryFn });",
      filename: 'src/user.test.ts',
    },
    {
      code: "useQuery({ queryKey: ['user', id], queryFn });",
      filename: 'src/__tests__/user.ts',
    },
    {
      code: "useQuery({ queryKey: ['user', id], queryFn });",
      filename: 'src/keys/user.ts',
      options: [{ allowIn: ['**/keys/**'] }],
    },
  ],
  invalid: [
    {
      code: `useQuery({ queryKey: ['user', id], queryFn });`,
      errors: inline,
    },
    {
      code: `useInfiniteQuery({ queryKey: ['user', id], queryFn });`,
      errors: inline,
    },
    {
      code: `useSuspenseQuery({ queryKey: ['user', id], queryFn });`,
      errors: inline,
    },
    {
      code: `useSuspenseInfiniteQuery({ queryKey: ['user', id], queryFn });`,
      errors: inline,
    },
    {
      code: `useMutation({ mutationKey: ['user', 'save'], mutationFn });`,
      errors: inline,
    },
    {
      code: `queryOptions({ queryKey: ['user', id], queryFn });`,
      errors: inline,
    },
    {
      code: `queryClient.invalidateQueries({ queryKey: ['user'] });`,
      errors: inline,
    },
    {
      code: `queryClient.removeQueries({ queryKey: ['user'] });`,
      errors: inline,
    },
    {
      code: `queryClient.getQueryData({ queryKey: ['user'] });`,
      errors: inline,
    },
    {
      code: `queryClient.prefetchQuery({ queryKey: ['user', id], queryFn });`,
      errors: inline,
    },
    {
      code: `queryClient.setQueryData(['user', id], data);`,
      errors: inline,
    },
    {
      code: `queryClient.invalidateQueries(['user']);`,
      errors: inline,
    },
    {
      code: 'useQuery({ queryKey: [`user-${id}`], queryFn });',
      errors: inline,
    },
    {
      code: `useQuery({ queryKey: ['user', id] as const, queryFn });`,
      errors: inline,
    },
    {
      code: `useQueryClient().invalidateQueries({ queryKey: ['user'] });`,
      errors: inline,
    },
    {
      code: "useQueries({ queries: [{ queryKey: USER, queryFn }, { queryKey: ['post', id], queryFn }] });",
      errors: inline,
    },
    {
      code: "useApiQuery({ queryKey: ['user'] });",
      options: [{ keyHookNames: ['useApiQuery'] }],
      errors: inline,
    },
    {
      code: "useQuery({ queryKey: ['user'] });",
      options: [{ keyHookNames: ['useApiQuery'] }],
      errors: inline,
    },
    {
      code: "client.fetchQuery({ queryKey: ['user'] });",
      options: [{ clientMethodNames: ['fetchQuery'] }],
      errors: inline,
    },
    {
      code: "client.setQueryData(['user'], d);",
      options: [{ clientMethodNames: ['fetchQuery'] }],
      errors: inline,
    },
    {
      // A name in both lists is reported once.
      code: "client.prefetchQuery({ queryKey: ['user'] });",
      options: [{ keyHookNames: ['prefetchQuery'] }],
      errors: inline,
    },
    {
      // A set `allowIn` replaces the default test globs.
      code: "useQuery({ queryKey: ['user'] });",
      filename: 'src/user.test.ts',
      options: [{ allowIn: ['**/keys/**'] }],
      errors: inline,
    },
  ],
});
