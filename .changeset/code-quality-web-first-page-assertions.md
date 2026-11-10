---
'@noctcore/eslint-plugin-code-quality': minor
---

Add `prefer-web-first-page-assertions`: reports `expect(page.url())` and `expect(await page.title())` in Playwright specs, which check the page once, and suggests the retrying `await expect(page).toHaveURL(...)` / `toHaveTitle(...)` where the rewrite keeps the meaning. Opt-in, enable it for your spec files.
