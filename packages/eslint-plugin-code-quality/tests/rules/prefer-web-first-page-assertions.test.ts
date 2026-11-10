import { ruleTester } from '@noctcore/eslint-test-utils';

import { preferWebFirstPageAssertionsRule } from '../../src/rules/prefer-web-first-page-assertions';

const filename = 'e2e/specs/auth.spec.ts';

ruleTester.run('prefer-web-first-page-assertions', preferWebFirstPageAssertionsRule, {
  valid: [
    // The web-first forms retry until they pass or time out.
    { filename, code: "test('x', async ({ page }) => { await expect(page).toHaveURL('/dashboard'); });" },
    {
      filename,
      code: "test('x', async ({ page }) => { await expect(page).toHaveURL((url) => url.searchParams.get('tab') === 'billing'); });",
    },
    { filename, code: "test('x', async ({ page }) => { await expect(page).toHaveTitle(/Sign in/); });" },
    // `expect.poll` already retries its getter.
    {
      filename,
      code: "test('x', async ({ page }) => { await expect.poll(() => page.url()).toContain('/dashboard'); });",
    },
    // A read inside a `toPass` block is retried with the block.
    {
      filename,
      code: "test('x', async ({ page }) => { await expect(async () => { expect(page.url()).toContain('/done'); }).toPass(); });",
    },
    // Reads outside an expect subject: navigation helpers and expected values.
    { filename, code: "test('x', async ({ page }) => { const before = page.url(); await page.goto(before); });" },
    { filename, code: "test('x', async ({ page, other }) => { expect(other.url()).toBe(page.url()); });" },
    // Not the page fixture: a response URL read once is a fixed value.
    {
      filename,
      code: "test('x', async ({ page }) => { const response = await page.waitForResponse('**/api/me'); expect(response.url()).toContain('/api/me'); });",
    },
    // A call with arguments is not the zero-argument page read.
    { filename, code: "expect(page.url('relative')).toBe('x');" },
    // A locator read is out of scope here (eslint-plugin-playwright covers it).
    { filename, code: "test('x', async ({ page }) => { expect(await page.getByRole('heading').textContent()).toBe('Hi'); });" },
    // A custom fixture name that is not configured.
    { filename, code: "test('x', async ({ adminPage }) => { expect(adminPage.url()).toContain('/admin'); });" },
  ],
  invalid: [
    // The address bar read once, possibly before the redirect landed.
    {
      filename,
      code: "test('x', async ({ page }) => {\n  await page.getByRole('button', { name: 'Sign in' }).click();\n  expect(page.url()).toBe('http://localhost:5173/dashboard');\n});",
      errors: [
        {
          messageId: 'oneShotRead',
          line: 3,
          column: 10,
          suggestions: [
            {
              messageId: 'useMatcher',
              output:
                "test('x', async ({ page }) => {\n  await page.getByRole('button', { name: 'Sign in' }).click();\n  await expect(page).toHaveURL('http://localhost:5173/dashboard');\n});",
            },
          ],
        },
      ],
    },
    // A query-string check through `new URL(...)`: no rewrite, the predicate form fits.
    {
      filename,
      code: "test('x', async ({ page }) => { expect(new URL(page.url()).search).toBe('?tab=billing'); });",
      errors: [{ messageId: 'oneShotRead', suggestions: [] }],
    },
    // `toContain` has no equivalent string argument for toHaveURL.
    {
      filename,
      code: "test('x', async ({ page }) => { expect(page.url()).toContain('/dashboard'); });",
      errors: [{ messageId: 'oneShotRead', suggestions: [] }],
    },
    // The title, awaited, with a regex: translated to toHaveTitle.
    {
      filename,
      code: "test('x', async ({ page }) => { expect(await page.title()).toMatch(/Settings/); });",
      errors: [
        {
          messageId: 'oneShotRead',
          suggestions: [
            {
              messageId: 'useMatcher',
              output: "test('x', async ({ page }) => { await expect(page).toHaveTitle(/Settings/); });",
            },
          ],
        },
      ],
    },
    // `toMatch` with a string is a substring check, not a full match: no rewrite.
    {
      filename,
      code: "test('x', async ({ page }) => { expect(await page.title()).toMatch('Settings'); });",
      errors: [{ messageId: 'oneShotRead', suggestions: [] }],
    },
    // Negated and soft forms keep their modifiers.
    {
      filename,
      code: "test('x', async ({ page }) => { expect.soft(page.url()).not.toBe(loginUrl); });",
      errors: [
        {
          messageId: 'oneShotRead',
          suggestions: [
            {
              messageId: 'useMatcher',
              output: "test('x', async ({ page }) => { await expect.soft(page).not.toHaveURL(loginUrl); });",
            },
          ],
        },
      ],
    },
    // A page object holding the page as a member.
    {
      filename,
      code: 'class Login { async assertDone() { expect(this.page.url()).toEqual(this.doneUrl); } }',
      errors: [
        {
          messageId: 'oneShotRead',
          suggestions: [
            {
              messageId: 'useMatcher',
              output: 'class Login { async assertDone() { await expect(this.page).toHaveURL(this.doneUrl); } }',
            },
          ],
        },
      ],
    },
    // A non-async callback cannot take an `await`: reported without a rewrite.
    {
      filename,
      code: "test('x', ({ page }) => { expect(page.url()).toBe('/'); });",
      errors: [{ messageId: 'oneShotRead', suggestions: [] }],
    },
    // A configured fixture name.
    {
      filename,
      code: "test('x', async ({ adminPage }) => { expect(adminPage.url()).toContain('/admin'); });",
      options: [{ pages: ['page', 'adminPage'] }],
      errors: [{ messageId: 'oneShotRead', suggestions: [] }],
    },
  ],
});
