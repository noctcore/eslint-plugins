# `noctcore-code-quality/no-message-only-throw-assertion`

> A throw assertion must pin the error class, not accept any error or only its wording.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`expect(fn).toThrow()` passes for any error. When the code under test breaks in a way that throws
something else, most often a `TypeError` from a mock that returns `undefined` where an object was
expected, the assertion still passes and the test stays green on a broken path.

A message alone is not much better. `toThrow('Employee not found.')` passes for any error class
carrying that sentence. When two refusals share their wording but differ in class (a `NotFoundError`
that says nothing about whether the record exists, and a `ForbiddenError` that confirms it does), the
difference between them is exactly what the test exists to defend, and a message check cannot see it.

```ts bad filename=src/employees/employee.service.test.ts reports=2
it('refuses an unknown employee', async () => {
  await expect(service.find('e-404')).rejects.toThrow();
});

it('refuses another tenant', async () => {
  await expect(service.find('e-other')).rejects.toThrow('Employee not found.');
});
```

```ts good filename=src/employees/employee.service.test.ts
it('refuses an unknown employee', async () => {
  await expect(service.find('e-404')).rejects.toThrow(NotFoundError);
});

it('refuses another tenant', async () => {
  await expect(service.find('e-other')).rejects.toThrow(NotFoundError);
  await expect(service.find('e-other')).rejects.toThrow('Employee not found.');
});
```

## What it flags

A `toThrow` / `toThrowError` matcher on an `expect(...)` chain, sync or after `.rejects`, that is not
negated and whose argument:

- `bareThrow`: is missing: `toThrow()`, `.rejects.toThrowError()`;
- `messageOnlyThrow`: checks only the message: a string, a template literal, a regex literal, a
  `RegExp` built with `new RegExp(...)`, or `expect.objectContaining({ message: ... })`. A
  snapshot of the error (`toThrowErrorMatchingSnapshot()`, `toThrowErrorMatchingInlineSnapshot()`)
  records only its message, so it is a message check too, whatever its argument.

It reports inside and outside test callbacks, so a shared helper that asserts `.rejects.toThrow()`
is reported where it is written.

```ts bad filename=src/lib/api-path.test.ts reports=3
it('rejects an absolute url', () => {
  expect(() => toApiPath('https://evil.test')).toThrow('Refusing a non-relative api path');
});

it('rejects an unknown queue', () => {
  expect(() => metrics.onModuleInit()).toThrow(new RegExp(`Queue "${missing}" is declared`));
});

export async function expectRefusal(promise: Promise<unknown>) {
  await expect(promise).rejects.toThrow();
}
```

```ts good filename=src/lib/api-path.test.ts
it('rejects an absolute url', () => {
  expect(() => toApiPath('https://evil.test')).toThrow(UnsafePathError);
});

it('rejects an unknown queue', () => {
  expect(() => metrics.onModuleInit()).toThrow(
    expect.objectContaining({ name: 'QueueConfigError', queue: missing }),
  );
});

export async function expectRefusal(promise: Promise<unknown>) {
  await expect(promise).rejects.toBeInstanceOf(DomainError);
}
```

### Class and message asserted separately

A message-only assertion is accepted when the same test also pins the class of the same subject (the
same source text inside `expect(...)`) with a class-pinning throw matcher, a `.rejects` matcher that
checks more than the message, or a configured `assertionHelpers` call whose first argument is that
subject. The `.rejects` matchers that count:

- `toBeInstanceOf(X)`;
- `toMatchObject(...)`, unless its argument is an object with no key but `message` (`{ message: 'm' }`
  pins nothing else), or an error instance while `trustErrorInstances` is off;
- `toHaveProperty(path, ...)`, unless the path is `'message'` or `['message']`;
- `toEqual(...)` / `toStrictEqual(...)`, unless the argument is an error instance while
  `trustErrorInstances` is off: Jest's `equals()` compares two errors by their message alone. Some refusals differ
only in wording, and there the sentence is the assertion; the class next to it keeps it honest.

The pin must run whenever the message check runs: it has to sit in the same block as the message
check or in a block that encloses it. A class pinned in one branch of an `if` does not excuse a
message check in the other branch, or one after the `if`. A bare `toThrow()` is never excused by a
pin: a later call on the same subject is usually a different scenario, and any error satisfies it.

```ts bad filename=src/employees/employee.service.test.ts reports=2
it('refuses', async () => {
  if (strict) {
    await expect(service.find('e-other')).rejects.toThrow(NotFoundError);
  } else {
    await expect(service.find('e-other')).rejects.toThrow('Employee not found.');
  }
  repository.find.mockResolvedValue({ deleted: true });
  await expect(service.find('e-other')).rejects.toThrow();
});
```

```ts good filename=src/employees/employee.service.test.ts
it('refuses', async () => {
  await expect(service.find('e-other')).rejects.toThrow(NotFoundError);
  if (!strict) {
    await expect(service.find('e-other')).rejects.toThrow('Employee not found.');
  }
  repository.find.mockResolvedValue({ deleted: true });
  await expect(service.find('e-other')).rejects.toThrow(GoneError);
});
```

## What it does not flag

- A class argument (`toThrow(NotFoundError)`, `toThrow(errors.Forbidden)`), an asymmetric matcher
  (`toThrow(expect.objectContaining({ code: 'E_LOCKED' }))`) or any other value that is not a string,
  template or regex.
- An error instance (`toThrow(new ForbiddenError('No access'))`) while `trustErrorInstances` is on:
  Vitest compares it like `toEqual`, so its class name takes part. See Options for Jest.
- `.not.toThrow()` and `.resolves.not.toThrow()`: a negated throw assertion has no class to pin.
- `.rejects.toMatchObject(...)` and the other value matchers on their own.
- A message held in a variable (`toThrow(expectedMessage)`): the rule reads syntax, not values, and
  treats it as it would an error class.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `throwMatchers` | `string[]` | `["toThrow", "toThrowError", "toThrowErrorMatchingSnapshot", "toThrowErrorMatchingInlineSnapshot"]` | Matchers that assert a throw or a rejection. A name ending in `MatchingSnapshot` or `MatchingInlineSnapshot` is always a message check. |
| `allowMessageOnly` | `boolean` | `false` | Report only the argless form. For adopting the rule in two steps. |
| `trustErrorInstances` | `boolean` | `true` | Count an error instance argument as pinning the class. Set `false` under Jest, whose `toThrow(new X('m'))` and `.rejects.toEqual(new X('m'))` compare only the message. |
| `assertionHelpers` | `string[]` (regex sources) | `[]` | Helpers that pin the error class, such as `expectRejectsDomainError(promise, {...})`. A call on the same subject in the same test accepts a message-only assertion. Matched against `name` or `obj.name`. |

```js
'noctcore-code-quality/no-message-only-throw-assertion': ['error', {
  // Jest compares an error instance by its message only.
  trustErrorInstances: false,
  assertionHelpers: ['^expect(Throws|Rejects)DomainError$'],
}]
```

Under `trustErrorInstances: false` an instance is a message check:

```ts bad filename=src/auth/guard.spec.ts options={"trustErrorInstances":false}
it('refuses a guest', () => {
  expect(() => guard.check(guest)).toThrow(new ForbiddenError('No access'));
});
```

```ts good filename=src/auth/guard.spec.ts options={"trustErrorInstances":false}
it('refuses a guest', () => {
  expect(() => guard.check(guest)).toThrow(ForbiddenError);
  expect(() => guard.check(guest)).toThrow('No access');
});
```

The same goes for a `.rejects` equality check used as the pin:

```ts bad filename=src/auth/guard.spec.ts options={"trustErrorInstances":false}
it('refuses a guest', async () => {
  await expect(guard.load(guest)).rejects.toEqual(new ForbiddenError('No access'));
  await expect(guard.load(guest)).rejects.toThrow('No access');
});
```

```ts good filename=src/auth/guard.spec.ts options={"trustErrorInstances":false}
it('refuses a guest', async () => {
  await expect(guard.load(guest)).rejects.toMatchObject({ name: 'ForbiddenError', code: 'E_FORBIDDEN' });
  await expect(guard.load(guest)).rejects.toThrow('No access');
});
```

## When not to use it

In a codebase that throws one plain `Error` class everywhere, where the message is the only thing
that tells refusals apart. Start with `allowMessageOnly: true` there: the argless form is still a
defect.

## Related

- [`no-swallowed-assertion`](./no-swallowed-assertion.md): an assertion whose failure is caught and
  dropped.
- [`no-vacuous-expect`](./no-vacuous-expect.md): assertions that pass for almost any implementation.
