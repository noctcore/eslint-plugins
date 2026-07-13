import { describe, expect, it } from 'vitest';

import { ruleTester } from '@noctcore/eslint-test-utils';

import { compileDenyPropNames, propsMustBeVisualRule } from '../../src/rules/props-must-be-visual';

// De-projected: the component-file gate is dropped — the rule keys off the
// `*Props` naming convention and applies wherever such a contract is declared.
const FILE = 'LoginForm.tsx';

ruleTester.run('props-must-be-visual', propsMustBeVisualRule, {
  valid: [
    // Visual props.
    {
      code: `interface LoginFormProps { label: string; disabled?: boolean; }`,
      filename: FILE,
    },
    // Non-Props interface is not a props surface.
    {
      code: `interface AuthState { userId: string; token: string; }`,
      filename: FILE,
    },
    // Visual props expressed as a type-alias object literal.
    {
      code: `type LoginFormProps = { label: string; disabled?: boolean; };`,
      filename: FILE,
    },
    // A non-Props type alias is not a props surface.
    {
      code: `type AuthState = { userId: string; token: string; };`,
      filename: FILE,
    },
    // A live `password` input is a legitimate visual concern (not on the denylist).
    {
      code: `interface LoginFormProps { password: string; }`,
      filename: FILE,
    },
    // Layout-independent: a visual `*Props` passes even in a plain `.ts` module.
    {
      code: `interface ThingProps { label: string; }`,
      filename: 'src/lib/types.ts',
    },
    // A custom denylist can whitelist by narrowing to a single pattern.
    {
      code: `interface LoginFormProps { token: string; }`,
      filename: FILE,
      options: [{ denyPropNames: ['^ssn$'] }],
    },
  ],
  invalid: [
    {
      code: `interface LoginFormProps { userId: string; }`,
      filename: FILE,
      errors: [{ messageId: 'nonVisualProp' }],
    },
    {
      code: `interface LoginFormProps { resetToken: string; }`,
      filename: FILE,
      errors: [{ messageId: 'nonVisualProp' }],
    },
    {
      code: `interface LoginFormProps { currentUser: unknown; }`,
      filename: FILE,
      errors: [{ messageId: 'nonVisualProp' }],
    },
    // Type-alias object-literal props are checked just like interfaces.
    {
      code: `type LoginFormProps = { userId: string; };`,
      filename: FILE,
      errors: [{ messageId: 'nonVisualProp' }],
    },
    {
      code: `type LoginFormProps = { resetToken: string; };`,
      filename: FILE,
      errors: [{ messageId: 'nonVisualProp' }],
    },
    // Layout-independent: a credential prop in a plain `.ts` `*Props` still reds.
    {
      code: `interface ThingProps { token: string; }`,
      filename: 'src/lib/auth-types.ts',
      errors: [{ messageId: 'nonVisualProp' }],
    },
    // A custom denylist can flag a project-specific name.
    {
      code: `interface LoginFormProps { ssn: string; }`,
      filename: FILE,
      options: [{ denyPropNames: ['^ssn$'] }],
      errors: [{ messageId: 'nonVisualProp' }],
    },
  ],
});

describe('compileDenyPropNames', () => {
  it('compiles valid patterns', () => {
    const patterns = compileDenyPropNames(['^userId$', 'token']);
    expect(patterns).toHaveLength(2);
    expect(patterns[0]?.test('userId')).toBe(true);
  });

  it('throws an actionable error naming the malformed pattern', () => {
    expect(() => compileDenyPropNames(['^valid$', '(['])).toThrow(/\(\[/);
    expect(() => compileDenyPropNames(['(['])).toThrow(/Invalid `denyPropNames` entry/);
  });
});
