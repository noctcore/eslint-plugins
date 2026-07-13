import { ruleTester } from '@noctcore/eslint-test-utils';

import { colocatedTestRequiredRule } from '../../src/rules/colocated-test-required';

const HOOKS = [{ include: ['**/use*.ts'] }] as const;
const SERVICES = [{ include: ['**/*.service.ts'] }] as const;

// Fixtures under tests/fixtures/colocated/** carry (or omit) the test siblings.
ruleTester.run('colocated-test-required', colocatedTestRequiredRule, {
  valid: [
    // Hook with a colocated `.test.ts` sibling on disk.
    {
      code: `export function useTested() { return 1; }`,
      filename: 'tests/fixtures/colocated/useTested.ts',
      options: HOOKS,
    },
    // Service with a colocated `.spec.ts` sibling on disk.
    {
      code: `export const paymentService = {};`,
      filename: 'tests/fixtures/colocated/payment.service.ts',
      options: SERVICES,
    },
    // Off by default: no `include` means the rule never fires.
    {
      code: `export function useUntested() { return 2; }`,
      filename: 'tests/fixtures/colocated/useUntested.ts',
    },
    // A file that does not match `include` is not gated.
    {
      code: `export const thing = 1;`,
      filename: 'tests/fixtures/colocated/thing.ts',
      options: HOOKS,
    },
    // A test file that itself matches `include` is exempt (never tests itself).
    {
      code: `export const x = 1;`,
      filename: 'tests/fixtures/colocated/useTested.test.ts',
      options: HOOKS,
    },
    // `ignore` skips an otherwise-gated file.
    {
      code: `export function useUntested() { return 2; }`,
      filename: 'tests/fixtures/colocated/useUntested.ts',
      options: [{ include: ['**/use*.ts'], ignore: ['**/useUntested.ts'] }],
    },
  ],
  invalid: [
    // Hook with no colocated test on disk.
    {
      code: `export function useUntested() { return 2; }`,
      filename: 'tests/fixtures/colocated/useUntested.ts',
      options: HOOKS,
      errors: [{ messageId: 'missingTest' }],
    },
    // Service with no colocated test on disk.
    {
      code: `export const orphanService = {};`,
      filename: 'tests/fixtures/colocated/orphan.service.ts',
      options: SERVICES,
      errors: [{ messageId: 'missingTest' }],
    },
  ],
});
