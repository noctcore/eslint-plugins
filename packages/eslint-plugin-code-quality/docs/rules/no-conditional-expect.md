# `noctcore-code-quality/no-conditional-expect`

> An `expect()` that may not run lets a broken test pass.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

An assertion inside an `if`, a `switch` case, a ternary, a `&&` / `||` / `??` or a `catch` only runs
when that branch is taken. When the code under test changes so the branch is skipped, the test
passes with zero assertions. The classic case is `try { await f(); } catch (e) { expect(e)... }`:
if `f` stops throwing, the test goes green.

The rule matches on method names, so it covers Jest, Vitest and Bun alike.

## What it flags

`expect(...)`, or `obj.expect(...)` on an identifier (`t.expect`, `chai.expect`), whose path up to
the enclosing test or suite callback crosses the conditional part of a branch. The test of an `if`
and the left side of a logical expression run unconditionally and are not flagged.

The search stops at the enclosing `it` / `test` / `describe` / `suite` callback, so a suite-level
loop or `if` that generates tests does not flag the expects inside those tests.

A test that calls `expect.assertions(n)` or `expect.hasAssertions()` is exempt: a skipped branch
already fails it.

```ts bad filename=src/parse.test.ts reports=2
it('rejects bad input', async () => {
  try {
    await parse('');
  } catch (error) {
    expect(error).toBeInstanceOf(ParseError);
  }
});

it('returns the value', () => {
  const result = load();
  if (result.ok) {
    expect(result.value).toBe(1);
  }
});
```

```ts good filename=src/parse.test.ts
it('rejects bad input', async () => {
  await expect(parse('')).rejects.toBeInstanceOf(ParseError);
});

it('returns the value', () => {
  expect(load()).toEqual({ ok: true, value: 1 });
});

describe('parse', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(parse(c.input)).toEqual(c.output);
    });
  }
});
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `checkLoops` | `boolean` | `false` | Also treat a `for` / `for...in` / `for...of` / `while` / `do...while` body as conditional, since a loop over an empty collection asserts nothing. |

`checkLoops` is off by default because loops are mostly noise: on a real 650-file suite, loops made
up 164 of 173 reports, almost all table-driven loops over literal arrays and constant maps.

```js
'noctcore-code-quality/no-conditional-expect': ['error', { checkLoops: true }]
```

## When not to use it

If your suites rely on type-narrowing guards such as `if (result.success) expect(result.data)...`
after an unconditional `expect(result.success).toBe(true)`, and you do not want to rewrite them.

## Credits

Based on a rule from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
