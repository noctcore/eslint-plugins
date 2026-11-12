import { ruleTester, workspacePath } from "@noctcore/eslint-test-utils";
import { expect, it } from "vitest";

import { noDirectProcessEnvRule } from "../../src/rules/no-direct-process-env";

const component = "apps/web/src/components/Header.tsx";
const viteOptions = [{ sources: ["import.meta.env"] }] as const;
const options = [
  { allowedFiles: ["**/apps/server/**", "**/*.{spec,test}.{ts,tsx}"] },
] as const;

ruleTester.run("no-direct-process-env", noDirectProcessEnvRule, {
  valid: [
    // A repo-relative glob matches the absolute filename ESLint passes, read
    // relative to the workspace root (or the working directory).
    {
      code: "const url = process.env.DATABASE_URL;",
      filename: workspacePath("apps", "server", "src", "env.ts"),
      options: [{ allowedFiles: ["apps/server/**"] }],
    },
    // The same exemption under the standard `allowIn` name (`allowedFiles` is its deprecated alias).
    {
      code: "const url = process.env.DATABASE_URL;",
      filename: workspacePath("apps", "server", "src", "env.ts"),
      options: [{ allowIn: ["apps/server/**"] }],
    },
    {
      code: "const port = config.get('PORT');",
      filename: "apps/web/src/lib/runtime.ts",
      options,
    },
    // Allowlisted server file may read process.env directly.
    {
      code: "const name = process.env.SERVICE_NAME ?? 'server';",
      filename: "apps/server/src/main.ts",
      options,
    },
    // Allowlisted test file may stub env.
    {
      code: "process.env.NODE_ENV = 'production';",
      filename: "apps/web/src/lib/runtime.test.ts",
      options,
    },
    // `process.environment` is a different property, not policed.
    {
      code: "const local = process.environment;",
      filename: "apps/web/src/lib/runtime.ts",
      options,
    },
    // Default allowlist covers config files.
    {
      code: "const v = process.env.NODE_ENV;",
      filename: "vite.config.ts",
    },
    // ...in every module flavour, tests written in plain JavaScript, and repo tooling.
    { code: "const v = process.env.NODE_ENV;", filename: "vite.config.mts" },
    {
      code: "const v = process.env.NODE_ENV;",
      filename: "/repo/apps/web/vitest.config.cts",
    },
    {
      code: "process.env.TZ = 'UTC';",
      filename: "/repo/packages/cli/src/a.test.js",
    },
    { code: "process.env.TZ = 'UTC';", filename: "src/a.spec.mjs" },
    {
      code: "const dir = process.env.VERIFY_DIR;",
      filename: "/repo/tools/verify/run.ts",
    },
    {
      code: "const token = process.env.GITHUB_TOKEN;",
      filename: "scripts/release.mjs",
    },
    // Default sources leave import.meta.env alone.
    { code: "const url = import.meta.env.VITE_API_URL;", filename: component },
    // With only import.meta.env configured, process.env is not policed.
    {
      code: "const url = process.env.DATABASE_URL;",
      filename: component,
      options: viteOptions,
    },
    {
      code: "const url = import.meta.env.VITE_API_URL;",
      filename: "apps/web/src/lib/env.ts",
      options: [
        { sources: ["import.meta.env"], allowIn: ["**/src/lib/env.ts"] },
      ],
    },
    // Vite build constants are not user configuration.
    ...[
      "const mode = import.meta.env.MODE;",
      "if (import.meta.env.DEV) {}",
      "const p = import.meta.env.PROD;",
      "const s = import.meta.env.SSR;",
      "const base = import.meta.env.BASE_URL;",
      "const d = import.meta.env['DEV'];",
      "const { DEV, MODE } = import.meta.env;",
      "let dev; ({ DEV: dev } = import.meta.env);",
    ].map((code) => ({ code, filename: component, options: viteOptions })),
  ],
  invalid: [
    // A repo-relative glob matches the absolute filename ESLint passes, read
    // relative to the workspace root (or the working directory).
    {
      code: "const url = process.env.DATABASE_URL;",
      filename: workspacePath("apps", "web", "src", "env.ts"),
      options: [{ allowedFiles: ["apps/server/**"] }],
      errors: [{ messageId: "directProcessEnv" }],
    },
    // Application code next to the allowlisted shapes is still checked.
    {
      code: "const url = process.env.DATABASE_URL;",
      filename: "/repo/apps/api/src/toolsService.ts",
      errors: [{ messageId: "directProcessEnv" }],
    },
    {
      code: "const url = process.env.DATABASE_URL;",
      filename: "/repo/apps/api/src/config.service.ts",
      errors: [
        {
          messageId: "directProcessEnv",
          data: { configModule: "@/config", source: "process.env" },
        },
      ],
    },
    {
      code: "const isProd = process.env.NODE_ENV === 'production';",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    {
      code: "const { DATABASE_URL } = process.env;",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    {
      code: "const v = process.env['CORS_ORIGINS'];",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    // `process.env` passed as a value (argument) must be flagged too.
    {
      code: "log(process.env);",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    // `process.env` returned from a function must be flagged.
    {
      code: "function getEnv() { return process.env; }",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    // `process.env` assigned directly (no destructure) must be flagged.
    {
      code: "const env = process.env;",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    // Computed access `process['env']` must not bypass the rule.
    {
      code: "const env = process['env'];",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    // Computed access followed by a property read is still flagged.
    {
      code: "const v = process['env'].NODE_ENV;",
      filename: "apps/web/src/lib/runtime.ts",
      options,
      errors: [{ messageId: "directProcessEnv" }],
    },
    ...[
      "const url = import.meta.env.VITE_API_URL;",
      "const env = import.meta['env'];",
      "const { VITE_X } = import.meta.env;",
      "log(import.meta.env);",
      "const { DEV, VITE_X } = import.meta.env;",
      "const { DEV, ...rest } = import.meta.env;",
      "const n = import.meta.env.NODE_ENV;",
    ].map((code) => ({
      code,
      filename: component,
      options: viteOptions,
      errors: [{ messageId: "directProcessEnv" as const }],
    })),
    // The build constant exemption applies to import.meta.env only.
    {
      code: "const m = process.env.MODE;",
      filename: component,
      errors: [{ messageId: "directProcessEnv" }],
    },
    {
      code: "const a = process.env.A; const b = import.meta.env.VITE_B;",
      filename: component,
      options: [{ sources: ["process.env", "import.meta.env"] }],
      errors: [
        {
          messageId: "directProcessEnv",
          data: { configModule: "@/config", source: "process.env" },
        },
        {
          messageId: "directProcessEnv",
          data: { configModule: "@/config", source: "import.meta.env" },
        },
      ],
    },
    {
      code: "const url = import.meta.env.VITE_API_URL;",
      filename: component,
      options: [{ configModule: "@acme/config", sources: ["import.meta.env"] }],
      errors: [
        {
          messageId: "directProcessEnv",
          data: { configModule: "@acme/config", source: "import.meta.env" },
        },
      ],
    },
  ],
});

it("names the source read in the report message", () => {
  const message = noDirectProcessEnvRule.meta.messages.directProcessEnv;
  expect(message).toContain("{{source}}");
  expect(message).toContain("{{configModule}}");
  expect(message).not.toContain("`process.env`");
});
