import { ruleTester } from '@noctcore/eslint-test-utils';

import { noDirectProcessEnvRule } from '../../src/rules/no-direct-process-env';

const options = [{ allowedFiles: ['**/apps/server/**', '**/*.{spec,test}.{ts,tsx}'] }] as const;

ruleTester.run('no-direct-process-env', noDirectProcessEnvRule, {
  valid: [
    {
      code: "const port = config.get('PORT');",
      filename: 'apps/web/src/lib/runtime.ts',
      options,
    },
    // Allowlisted server file may read process.env directly.
    {
      code: "const name = process.env.SERVICE_NAME ?? 'server';",
      filename: 'apps/server/src/main.ts',
      options,
    },
    // Allowlisted test file may stub env.
    {
      code: "process.env.NODE_ENV = 'production';",
      filename: 'apps/web/src/lib/runtime.test.ts',
      options,
    },
    // `process.environment` is a different property, not policed.
    {
      code: 'const local = process.environment;',
      filename: 'apps/web/src/lib/runtime.ts',
      options,
    },
    // Default allowlist covers config files.
    {
      code: 'const v = process.env.NODE_ENV;',
      filename: 'vite.config.ts',
    },
    // ...in every module flavour, tests written in plain JavaScript, and repo tooling.
    { code: 'const v = process.env.NODE_ENV;', filename: 'vite.config.mts' },
    { code: 'const v = process.env.NODE_ENV;', filename: '/repo/apps/web/vitest.config.cts' },
    { code: "process.env.TZ = 'UTC';", filename: '/repo/packages/cli/src/a.test.js' },
    { code: "process.env.TZ = 'UTC';", filename: 'src/a.spec.mjs' },
    { code: 'const dir = process.env.VERIFY_DIR;', filename: '/repo/tools/verify/run.ts' },
    { code: 'const token = process.env.GITHUB_TOKEN;', filename: 'scripts/release.mjs' },
  ],
  invalid: [
    // Application code next to the allowlisted shapes is still checked.
    {
      code: 'const url = process.env.DATABASE_URL;',
      filename: '/repo/apps/api/src/toolsService.ts',
      errors: [{ messageId: 'directProcessEnv' }],
    },
    {
      code: 'const url = process.env.DATABASE_URL;',
      filename: '/repo/apps/api/src/config.service.ts',
      errors: [{ messageId: 'directProcessEnv', data: { configModule: '@/config' } }],
    },
    {
      code: "const isProd = process.env.NODE_ENV === 'production';",
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    {
      code: 'const { DATABASE_URL } = process.env;',
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    {
      code: "const v = process.env['CORS_ORIGINS'];",
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    // `process.env` passed as a value (argument) must be flagged too.
    {
      code: 'log(process.env);',
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    // `process.env` returned from a function must be flagged.
    {
      code: 'function getEnv() { return process.env; }',
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    // `process.env` assigned directly (no destructure) must be flagged.
    {
      code: 'const env = process.env;',
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    // Computed access `process['env']` must not bypass the rule.
    {
      code: "const env = process['env'];",
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
    // Computed access followed by a property read is still flagged.
    {
      code: "const v = process['env'].NODE_ENV;",
      filename: 'apps/web/src/lib/runtime.ts',
      options,
      errors: [{ messageId: 'directProcessEnv' }],
    },
  ],
});
