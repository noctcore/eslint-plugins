# `noctcore-code-quality/prefer-web-first-page-assertions`

> Assert on the page with `toHaveURL` / `toHaveTitle`, which retry, not on a URL or title read once.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💡 Offers editor suggestions · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`expect(page.url()).toBe(...)` reads the address bar once, at whatever moment the line runs, and
compares the copy. After a click that redirects, that moment is often before the navigation lands,
so the test fails on a slow run and passes on a fast one. `await expect(page).toHaveURL(...)` retries
until the URL matches or the timeout runs out. The same goes for `page.title()` and `toHaveTitle`.

eslint-plugin-playwright's `prefer-web-first-assertions` covers locator reads (`textContent()`,
`isVisible()`, `inputValue()`) but not the page itself, which is why projects add a
`no-restricted-syntax` selector for `expect(page.url())`. This rule replaces that selector and also
covers the title, a page object's `this.page`, and `expect.soft`.

## What it flags

`page.url()` or `page.title()` (called with no arguments, also after `await`) anywhere inside the
subject of `expect(...)` or `expect.soft(...)`: directly, or inside an expression such as
`new URL(page.url()).search`. The receiver is a binding named in `pages`, or a member with that name
(`this.page`, `ctx.page`).

```ts bad filename=e2e/specs/auth.spec.ts reports=3
test('signs in', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  expect(page.url()).toBe('http://localhost:5173/dashboard');
  expect(new URL(page.url()).searchParams.get('tab')).toBe('billing');
  expect(await page.title()).toMatch(/Dashboard/);
});
```

```ts good filename=e2e/specs/auth.spec.ts
test('signs in', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('http://localhost:5173/dashboard');
  await expect(page).toHaveURL((url) => url.searchParams.get('tab') === 'billing');
  await expect(page).toHaveTitle(/Dashboard/);
});
```

### Suggestions

When the statement is `expect(page.url()).<matcher>(expected);` in an async function, the rule
offers a rewrite to `await expect(page).toHaveURL(expected);` (`toHaveTitle` for the title),
keeping `.not` and `expect.soft`. It does so only where the retrying matcher reads `expected` the
same way: after `toBe`, `toEqual` and `toStrictEqual`, and after `toMatch` with a regex literal.
`toContain`, `toMatch` with a string, and a computed subject (`new URL(page.url()).search`) get no
rewrite: write a regex or a predicate (`toHaveURL((url) => ...)`) by hand. It is a suggestion, not
an autofix, because `toHaveURL` resolves a relative string against the configured `baseURL`.

## What it does not flag

- A read inside a block Playwright already retries: the callback of `expect(async () => ...).toPass()`
  and the getter of `expect.poll(() => page.url())`.
- A read outside the subject: `const before = page.url()`, or `expect(other.url()).toBe(page.url())`
  where it is the expected value.
- Other receivers: `response.url()` after `waitForResponse` is a fixed value, so reading it once is
  right.
- Locator reads (`expect(await locator.textContent())`); use eslint-plugin-playwright's
  `prefer-web-first-assertions` for those.

### Limitations

A read stored first and asserted later (`const url = page.url(); expect(url).toBe(x)`) is not
followed. A fixture with another name (`adminPage`) is not matched until you add it to `pages`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pages` | `string[]` | `["page"]` | Names of the page fixture, matched as a binding (`page.url()`) or a member (`this.page.url()`). |

```js
// Playwright specs only, with a second page fixture.
{
  files: ['e2e/**/*.spec.ts'],
  rules: {
    'noctcore-code-quality/prefer-web-first-page-assertions': ['error', {
      pages: ['page', 'adminPage'],
    }],
  },
}
```

## When not to use it

Outside Playwright specs. Puppeteer, WebdriverIO and Jest have no `toHaveURL` on the page, and a
`page.title()` there can be an unrelated record. That is why the rule is not in `recommended`:
enable it with a `files` glob for your specs.
