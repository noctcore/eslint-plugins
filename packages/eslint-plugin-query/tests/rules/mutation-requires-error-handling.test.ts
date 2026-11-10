import { ruleTester } from '@noctcore/eslint-test-utils';

import { mutationRequiresErrorHandlingRule } from '../../src/rules/mutation-requires-error-handling';

const TSX = 'src/features/settings.tsx';

ruleTester.run('mutation-requires-error-handling', mutationRequiresErrorHandlingRule, {
  valid: [
    // onError on the hook.
    { code: `const save = useMutation({ mutationFn: saveName, onError: (e) => toast(e.message) });`, filename: TSX },
    // Errors go to the nearest error boundary.
    { code: `const save = useMutation({ mutationFn: saveName, throwOnError: true });`, filename: TSX },
    // tRPC v11 options factory carrying onError.
    { code: `const rename = useMutation(trpc.firm.rename.mutationOptions({ onError: notify }));`, filename: TSX },
    // tRPC v10 hook.
    { code: `const rename = trpc.firm.rename.useMutation({ onError: notify });`, filename: TSX },
    // Options from a local const.
    { code: `const opts = { mutationFn: saveName, onError: notify };\nconst save = useMutation(opts);`, filename: TSX },
    // onError per call.
    {
      code: `const save = useMutation({ mutationFn: saveName });\nfunction submit(v) { save.mutate(v, { onError: notify }); }`,
      filename: TSX,
    },
    {
      code: `const { mutate } = useMutation({ mutationFn: saveName });\nfunction submit(v) { mutate(v, { onError: notify }); }`,
      filename: TSX,
    },
    // mutateAsync awaited in a try with a catch.
    {
      code: `const save = useMutation({ mutationFn: saveName });\nasync function submit(v) { try { await save.mutateAsync(v); } catch (e) { setError(e); } }`,
      filename: TSX,
    },
    // mutateAsync with a .catch, and a .then with a rejection handler.
    {
      code: `const { mutateAsync } = useMutation({ mutationFn: saveName });\nfunction submit(v) { mutateAsync(v).catch(setError); }`,
      filename: TSX,
    },
    {
      code: `const save = useMutation({ mutationFn: saveName });\nfunction submit(v) { save.mutateAsync(v).then(close, setError); }`,
      filename: TSX,
    },
    // mutateAsync returned to a caller that may handle it.
    {
      code: `const save = useMutation({ mutationFn: saveName });\nconst submit = (v) => save.mutateAsync(v);`,
      filename: TSX,
    },
    // The component renders the error state.
    {
      code: `function Form() {\n  const save = useMutation({ mutationFn: saveName });\n  return <form onSubmit={() => save.mutate(name)}>{save.isError && <p>{save.error.message}</p>}</form>;\n}`,
      filename: TSX,
    },
    {
      code: `function Form() {\n  const { mutate, error } = useMutation({ mutationFn: saveName });\n  return <form onSubmit={() => mutate(name)}>{error ? <Alert error={error} /> : null}</form>;\n}`,
      filename: TSX,
    },
    // Returned from a custom hook: the caller decides.
    { code: `export function useSave() { return useMutation({ mutationFn: saveName }); }`, filename: TSX },
    // The result passed along.
    { code: `const save = useMutation({ mutationFn: saveName });\nuseToastOnError(save);`, filename: TSX },
    // mutate handed to a prop is not followed.
    {
      code: `function Row() {\n  const { mutate } = useMutation({ mutationFn: remove });\n  return <Button onClick={mutate} />;\n}`,
      filename: TSX,
    },
    // Options the rule cannot resolve.
    { code: `const save = useMutation(saveOptions(id));`, filename: TSX },
    { code: `const save = useMutation({ ...base, mutationFn: saveName });`, filename: TSX },
    { code: `function F(opts) { const save = useMutation(opts); save.mutate(); }`, filename: TSX },
    // A rest element keeps the result reachable.
    { code: `const { mutate, ...rest } = useMutation({ mutationFn: saveName });\nuse(rest);`, filename: TSX },
    // Not a listed hook.
    { code: `const save = useSaveMutation({ mutationFn: saveName });\nsave.mutate();`, filename: TSX },
  ],
  invalid: [
    // A mutation started from a click with nothing handling a failure.
    {
      code: `function Rename() {\n  const rename = useMutation({ mutationFn: (name) => api.rename(name) });\n  return <button onClick={() => rename.mutate('Acme')}>rename</button>;\n}`,
      filename: TSX,
      errors: [{ messageId: 'unhandled', line: 2 }],
    },
    // onSettled is not error handling.
    {
      code: `export function useStartScan() {\n  const mutation = useMutation({ mutationFn: startScan, onSettled: refresh });\n  return mutation.isPending ? undefined : () => mutation.mutate();\n}`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    // A per-call onSuccess without onError.
    {
      code: `const { mutate } = useMutation({ mutationFn: saveName });\nfunction submit(v) { mutate(v, { onSuccess: close }); }`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    // mutateAsync fired and forgotten.
    {
      code: `const save = useMutation({ mutationFn: saveName });\nfunction submit(v) { void save.mutateAsync(v); }`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    {
      code: `const save = useMutation({ mutationFn: saveName });\nasync function submit(v) { await save.mutateAsync(v); close(); }`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    // onError switched off.
    { code: `const save = useMutation({ mutationFn: saveName, onError: undefined });`, filename: TSX, errors: [{ messageId: 'unhandled' }] },
    { code: `const save = useMutation({ mutationFn: saveName, throwOnError: false });`, filename: TSX, errors: [{ messageId: 'unhandled' }] },
    // tRPC options factories without onError.
    {
      code: `const rename = useMutation(trpc.firm.rename.mutationOptions());\nrename.mutate({ id });`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    {
      code: `const rename = trpc.firm.rename.useMutation({ onSuccess: close });\nrename.mutate({ id });`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    // Options from a local const without onError.
    {
      code: `const opts = { mutationFn: saveName };\nconst save = useMutation(opts);\nsave.mutate(v);`,
      filename: TSX,
      errors: [{ messageId: 'unhandled' }],
    },
    // A custom hook name and a narrower handledBy.
    {
      code: `const save = useAppMutation({ mutationFn: saveName, throwOnError: true });\nsave.mutate();`,
      filename: TSX,
      options: [{ hooks: ['useAppMutation'], handledBy: ['onError'] }],
      errors: [{ messageId: 'unhandled' }],
    },
  ],
});
