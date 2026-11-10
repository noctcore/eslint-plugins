import { ruleTester } from '@noctcore/eslint-test-utils';

import { trpcInvalidateWithPathKeyRule } from '../../src/rules/trpc-invalidate-with-path-key';

ruleTester.run('trpc-invalidate-with-path-key', trpcInvalidateWithPathKeyRule, {
  valid: [
    {
      // Already the fix.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.billing.invoices.pathKey() });',
    },
    {
      // A key with an input is exact on purpose: it addresses one cache entry.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.invoices.get.queryKey({ id }) });',
    },
    {
      // An empty-object input is still an input, so the key stays exact.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.notifications.list.queryKey({}) });',
    },
    {
      // setQueryData addresses exactly one entry; out of scope.
      code: 'queryClient.setQueryData(trpc.notifications.list.queryKey(), next);',
    },
    {
      code: 'const data = queryClient.getQueryData(trpc.notifications.list.queryKey());',
    },
    {
      // Not the tRPC proxy: some other library's `queryKey()`.
      code: 'queryClient.invalidateQueries({ queryKey: other.list.queryKey() });',
    },
    {
      // `exact: true` against `[path]` would match nothing, so no swap is equivalent.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.x.list.queryKey(), exact: true });',
    },
    {
      // Not a configured cache method.
      code: 'client.somethingElse({ queryKey: trpc.x.list.queryKey() });',
    },
    {
      // A key built ahead of time is out of reach of a lexical rule.
      code: 'const key = trpc.x.list.queryKey(); queryClient.invalidateQueries({ queryKey: key });',
    },
    {
      // A different property holding the same call is not a filter key.
      code: 'queryClient.invalidateQueries({ predicate: () => trpc.x.list.queryKey() });',
    },
    {
      // Custom `methods` narrows the set, so the default methods are not checked.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.x.list.queryKey() });',
      options: [{ methods: ['refetchQueries'] }],
    },
    {
      // Custom `rootIdentifiers` replaces the default `trpc`.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.x.list.queryKey() });',
      options: [{ rootIdentifiers: ['api'] }],
    },
  ],
  invalid: [
    {
      code: 'queryClient.invalidateQueries({ queryKey: trpc.invoices.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'queryClient.invalidateQueries({ queryKey: trpc.invoices.list.pathKey() });',
    },
    {
      // Awaited, with the call spread over several lines.
      code: `
await queryClient.invalidateQueries({
  queryKey: trpc.billing.invoiceCounts
    .queryKey(),
});`,
      errors: [{ messageId: 'usePathKey' }],
      output: `
await queryClient.invalidateQueries({
  queryKey: trpc.billing.invoiceCounts
    .pathKey(),
});`,
    },
    {
      // Whitespace between the parens.
      code: 'queryClient.invalidateQueries({\n  queryKey: trpc.a.b.queryKey(\n  ),\n});',
      errors: [{ messageId: 'usePathKey' }],
      output: 'queryClient.invalidateQueries({\n  queryKey: trpc.a.b.pathKey(\n  ),\n});',
    },
    {
      // Receiver is matched by method name, so an imported client is covered.
      code: 'sharedQueryClient.invalidateQueries({ queryKey: trpc.firmy.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'sharedQueryClient.invalidateQueries({ queryKey: trpc.firmy.list.pathKey() });',
    },
    {
      // Inside Promise.all, the shape the mutation files use.
      code: `
Promise.all([
  queryClient.invalidateQueries({ queryKey: trpc.a.list.queryKey() }),
  queryClient.invalidateQueries({ queryKey: trpc.b.list.queryKey() }),
]);`,
      errors: [{ messageId: 'usePathKey' }, { messageId: 'usePathKey' }],
      output: `
Promise.all([
  queryClient.invalidateQueries({ queryKey: trpc.a.list.pathKey() }),
  queryClient.invalidateQueries({ queryKey: trpc.b.list.pathKey() }),
]);`,
    },
    {
      // Other filter properties stay as they are.
      code: 'queryClient.invalidateQueries({ queryKey: trpc.a.list.queryKey(), refetchType: "none" });',
      errors: [{ messageId: 'usePathKey' }],
      output:
        'queryClient.invalidateQueries({ queryKey: trpc.a.list.pathKey(), refetchType: "none" });',
    },
    {
      code: 'queryClient.refetchQueries({ queryKey: trpc.a.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'queryClient.refetchQueries({ queryKey: trpc.a.list.pathKey() });',
    },
    {
      code: 'await queryClient.cancelQueries({ queryKey: trpc.a.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'await queryClient.cancelQueries({ queryKey: trpc.a.list.pathKey() });',
    },
    {
      code: 'queryClient.removeQueries({ queryKey: trpc.a.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'queryClient.removeQueries({ queryKey: trpc.a.list.pathKey() });',
    },
    {
      code: 'queryClient.resetQueries({ queryKey: trpc.a.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'queryClient.resetQueries({ queryKey: trpc.a.list.pathKey() });',
    },
    {
      // A quoted key is the same property.
      code: 'queryClient.invalidateQueries({ "queryKey": trpc.a.list.queryKey() });',
      errors: [{ messageId: 'usePathKey' }],
      output: 'queryClient.invalidateQueries({ "queryKey": trpc.a.list.pathKey() });',
    },
    {
      // The filter helper form.
      code: 'queryClient.invalidateQueries(trpc.a.list.queryFilter());',
      errors: [{ messageId: 'usePathFilter' }],
      output: 'queryClient.invalidateQueries(trpc.a.list.pathFilter());',
    },
    {
      // Options: a different root proxy name and a narrowed method set.
      code: 'client.refetchQueries({ queryKey: api.a.list.queryKey() });',
      options: [{ methods: ['refetchQueries'], rootIdentifiers: ['api'] }],
      errors: [{ messageId: 'usePathKey' }],
      output: 'client.refetchQueries({ queryKey: api.a.list.pathKey() });',
    },
  ],
});
