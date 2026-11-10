import { ruleTester } from '@noctcore/eslint-test-utils';

import { effectFiredMutationMustBindCallbacksRule } from '../../src/rules/effect-fired-mutation-must-bind-callbacks';

ruleTester.run('effect-fired-mutation-must-bind-callbacks', effectFiredMutationMustBindCallbacksRule, {
  valid: [
    // Handlers on useMutation, a bare call in the effect: the shape the rule protects.
    {
      code: `
        const { mutate } = useMutation({ mutationFn: probe, onSuccess: () => setState('valid') });
        useEffect(() => { mutate({ token }); }, [token, mutate]);
      `,
    },
    // Per-call callbacks from a submit handler close over that one interaction.
    { code: `function onSubmit(data) { saveMutation.mutate(data, { onSuccess: close }); }` },
    { code: `useEffect(() => { ref.current = true; }, []);` },
    // A second argument without a per-call callback.
    { code: `useEffect(() => { mutate({ token }, { retry: false }); }, []);` },
    { code: `useEffect(() => { logoutMutation.mutate(); }, []);` },
    // Out of the effect again.
    {
      code: `
        useEffect(() => { mutate({ token }); }, []);
        function onClick() { mutate({ token }, { onSuccess: close }); }
      `,
    },
    // The dependency array is not the effect body.
    { code: `useEffect(noop, [mutate(v, { onSuccess: ok })]);` },
    // Not a listed effect hook.
    { code: `useCallback(() => { mutate(v, { onSuccess: ok }); }, []);` },
    // A computed callee is not followed.
    { code: `useEffect(() => { m[name](v, { onSuccess: ok }); }, []);` },
  ],
  invalid: [
    {
      code: `useEffect(() => { mutate({ token }, { onSuccess: (d) => setState(d.valid) }); }, []);`,
      errors: [{ messageId: 'mustBindToMutation', data: { method: 'mutate', callback: 'onSuccess' } }],
    },
    {
      code: `useEffect(() => { probeMutation.mutate(v, { onError: fail }); }, []);`,
      errors: [{ messageId: 'mustBindToMutation', data: { method: 'mutate', callback: 'onError' } }],
    },
    {
      code: `useEffect(() => { mutate(v, { onSettled: done }); }, []);`,
      errors: [{ messageId: 'mustBindToMutation', data: { method: 'mutate', callback: 'onSettled' } }],
    },
    {
      code: `useEffect(() => { void mutateAsync(v, { onSuccess: ok }); }, []);`,
      errors: [{ messageId: 'mustBindToMutation', data: { method: 'mutateAsync', callback: 'onSuccess' } }],
    },
    // Nested inside a helper declared in the effect: still effect-fired.
    {
      code: `useEffect(() => { const run = () => mutate(v, { onSuccess: ok }); run(); }, []);`,
      errors: [{ messageId: 'mustBindToMutation' }],
    },
    {
      code: `useLayoutEffect(() => { mutate(v, { onSuccess: ok }); }, []);`,
      errors: [{ messageId: 'mustBindToMutation' }],
    },
    {
      code: `React.useEffect(function () { this.invite.mutate(v, { onSuccess: ok }); }, []);`,
      errors: [{ messageId: 'mustBindToMutation' }],
    },
    // A custom effect hook through the options.
    {
      code: `useMountEffect(() => { mutate(v, { onSuccess: ok }); });`,
      options: [{ effectHooks: ['useMountEffect'] }],
      errors: [{ messageId: 'mustBindToMutation' }],
    },
  ],
});
