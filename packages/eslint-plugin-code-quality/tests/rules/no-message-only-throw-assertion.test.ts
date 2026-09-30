import { ruleTester } from '@noctcore/eslint-test-utils';

import { noMessageOnlyThrowAssertionRule } from '../../src/rules/no-message-only-throw-assertion';

ruleTester.run('no-message-only-throw-assertion', noMessageOnlyThrowAssertionRule, {
  valid: [
    // An error class argument pins the type.
    { code: "it('refuses', () => { expect(() => parse('x')).toThrow(ValidationError); });" },
    { code: "it('refuses', async () => { await expect(load(1)).rejects.toThrowError(NotFoundError); });" },
    { code: "it('refuses', () => { expect(() => run()).toThrow(errors.Forbidden); });" },
    // A structural rejection assertion instead of a throw matcher.
    {
      code: "it('refuses', async () => { await expect(load(1)).rejects.toMatchObject({ code: 'NOT_FOUND' }); });",
    },
    // An asymmetric matcher argument checks the shape, not only the wording.
    {
      code: "it('refuses', () => { expect(() => run()).toThrow(expect.objectContaining({ code: 'E_LOCKED' })); });",
    },
    // A negated throw assertion says nothing about the class.
    { code: "it('stays quiet', () => { expect(() => writePrompt('user-1:a')).not.toThrow(); });" },
    { code: "it('resolves', async () => { await expect(load(1)).resolves.not.toThrow(); });" },
    // An error instance pins the class under Vitest semantics (the default).
    { code: "it('refuses', () => { expect(() => run()).toThrow(new ForbiddenError('No access')); });" },
    // Class and message asserted separately on the same subject.
    {
      code: `
        it('refuses', async () => {
          await expect(service.find(id)).rejects.toThrow(NotFoundError);
          await expect(service.find(id)).rejects.toThrow('Employee not found.');
        });
      `,
    },
    {
      code: `
        it('refuses', async () => {
          await expect(service.find(id)).rejects.toBeInstanceOf(NotFoundError);
          await expect(service.find(id)).rejects.toThrow('Employee not found.');
        });
      `,
    },
    // A class pinned in an enclosing block covers a message check in a nested one.
    {
      code: `
        it('refuses every role', async () => {
          await expect(service.find(id)).rejects.toThrow(NotFoundError);
          for (const role of roles) {
            await expect(service.find(id)).rejects.toThrow('Employee not found.');
          }
        });
      `,
    },
    // Rejects matchers that check more than the message pin the class.
    { code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toMatchObject({ name: 'ForbiddenError', message: 'No access' });
          await expect(load(id)).rejects.toThrow('No access');
        });
      ` },
    { code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toHaveProperty('code', 'E_FORBIDDEN');
          await expect(load(id)).rejects.toThrow('No access');
        });
      ` },
    { code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toMatchObject(expect.any(ForbiddenError));
          await expect(load(id)).rejects.toThrow('No access');
        });
      ` },
    // Under Vitest semantics (the default) an error instance compares its name too.
    { code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toEqual(new ForbiddenError('No access'));
          await expect(load(id)).rejects.toThrow('No access');
        });
      ` },
    // A message snapshot next to a class pin on the same subject.
    {
      code: `
        it('refuses', () => {
          expect(() => guard.check(guest)).toThrow(ForbiddenError);
          expect(() => guard.check(guest)).toThrowErrorMatchingInlineSnapshot(\`"No access"\`);
        });
      `,
    },
    // A configured helper that pins the class, called on the same subject.
    {
      code: `
        it('refuses', async () => {
          await expectRejectsDomainError(service.find(id), { type: NotFoundError, appCode: 'EMPLOYEE_NOT_FOUND' });
          await expect(service.find(id)).rejects.toThrow('Employee not found.');
        });
      `,
      options: [{ assertionHelpers: ['^expectRejectsDomainError$'] }],
    },
    // allowMessageOnly keeps only the argless form in scope.
    {
      code: "it('refuses', () => { expect(() => toApiPath(url)).toThrow('Refusing a non-relative api path'); });",
      options: [{ allowMessageOnly: true }],
    },
    // A matcher outside the configured list is not a throw assertion.
    {
      code: "it('refuses', () => { expect(() => run()).toThrowError(); });",
      options: [{ throwMatchers: ['toThrow'] }],
    },
    // Not an expect chain.
    { code: 'emitter.toThrow();' },
  ],
  invalid: [
    // Settly shape: a Prisma rejection asserted with no argument.
    {
      code: `
        it('blocks the cross-tenant delete', async () => {
          await expect(client.firma.delete({ where: { id: firmaA.id } })).rejects.toThrow();
        });
      `,
      errors: [{ messageId: 'bareThrow', data: { matcher: 'toThrow' } }],
    },
    {
      code: "it('throws', () => { expect(() => parse('x')).toThrowError(); });",
      errors: [{ messageId: 'bareThrow', data: { matcher: 'toThrowError' } }],
    },
    // Settly shape: a string message only.
    {
      code: "it('refuses', () => { expect(() => toApiPath(url)).toThrow('Refusing a non-relative api path'); });",
      errors: [{ messageId: 'messageOnlyThrow', data: { matcher: 'toThrow' } }],
    },
    {
      code: "it('bubbles', async () => { await expect(run()).rejects.toThrow('boom'); });",
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    // A regex, a template and a built RegExp are all message checks.
    {
      code: "it('refuses', () => { expect(() => run()).toThrow(/not in stock/); });",
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    {
      code: 'it(\'refuses\', () => { expect(() => run()).toThrow(`Queue ${name} missing`); });',
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    {
      code: 'it(\'refuses\', () => { expect(() => service.onModuleInit()).toThrow(new RegExp(`Queue "${missing}" is declared`)); });',
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    // Under Jest semantics an error instance compares only its message.
    {
      code: "it('refuses', () => { expect(() => run()).toThrow(new ForbiddenError('No access')); });",
      options: [{ trustErrorInstances: false }],
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    // allowMessageOnly still reports the argless form.
    {
      code: "it('throws', async () => { await expect(load()).rejects.toThrow(); });",
      options: [{ allowMessageOnly: true }],
      errors: [{ messageId: 'bareThrow' }],
    },
    // Pinning a DIFFERENT subject does not pair.
    {
      code: `
        it('refuses', async () => {
          await expect(service.find(a)).rejects.toThrow(NotFoundError);
          await expect(service.find(b)).rejects.toThrow('Employee not found.');
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    // A pin in another test does not pair.
    {
      code: `
        it('pins', async () => { await expect(service.find(id)).rejects.toThrow(NotFoundError); });
        it('words', async () => { await expect(service.find(id)).rejects.toThrow('Employee not found.'); });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 3 }],
    },
    // A pinned class never excuses a bare throw: the second call is another scenario.
    {
      code: `
        it('refuses deleted records', async () => {
          await expect(svc.get(id)).rejects.toThrow(NotFound);
          repo.find.mockResolvedValue({ deleted: true });
          await expect(svc.get(id)).rejects.toThrow();
        });
      `,
      errors: [{ messageId: 'bareThrow', line: 5 }],
    },
    // A pin in one branch does not cover a message check in the other.
    {
      code: `
        it('refuses', async () => {
          if (strict) {
            await expect(service.find(id)).rejects.toThrow(NotFoundError);
          } else {
            await expect(service.find(id)).rejects.toThrow('Employee not found.');
          }
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 6 }],
    },
    // A pin nested deeper than the message check may not run.
    {
      code: `
        it('refuses', async () => {
          if (strict) {
            await expect(service.find(id)).rejects.toThrow(NotFoundError);
          }
          await expect(service.find(id)).rejects.toThrow('Employee not found.');
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 6 }],
    },
    // Under Jest semantics toEqual / toStrictEqual compare two errors by message only.
    {
      code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toEqual(new ForbiddenError('No access'));
          await expect(load(id)).rejects.toThrow('No access');
        });
      `,
      options: [{ trustErrorInstances: false }],
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    {
      code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toStrictEqual(new ForbiddenError('No access'));
          await expect(load(id)).rejects.toThrow('No access');
        });
      `,
      options: [{ trustErrorInstances: false }],
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    {
      code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toMatchObject(new ForbiddenError('No access'));
          await expect(load(id)).rejects.toThrow('No access');
        });
      `,
      options: [{ trustErrorInstances: false }],
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    // A message-only object or property is not a class pin.
    {
      code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toMatchObject({ message: 'No access' });
          await expect(load(id)).rejects.toThrow('No access');
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    {
      code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toHaveProperty('message', 'No access');
          await expect(load(id)).rejects.toThrow('No access');
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    {
      code: `
        it('refuses', async () => {
          await expect(load(id)).rejects.toHaveProperty(['message'], 'No access');
          await expect(load(id)).rejects.toThrow('No access');
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow', line: 4 }],
    },
    // An asymmetric matcher on the message alone is a message check.
    {
      code: "it('refuses', () => { expect(() => run()).toThrow(expect.objectContaining({ message: 'No access' })); });",
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    // A snapshot of the error records its message only.
    {
      code: "it('refuses', () => { expect(() => guard.check(guest)).toThrowErrorMatchingInlineSnapshot(`No access`); });",
      errors: [{ messageId: 'messageOnlyThrow', data: { matcher: 'toThrowErrorMatchingInlineSnapshot' } }],
    },
    {
      code: "it('refuses', async () => { await expect(load(id)).rejects.toThrowErrorMatchingSnapshot(); });",
      errors: [{ messageId: 'messageOnlyThrow', data: { matcher: 'toThrowErrorMatchingSnapshot' } }],
    },
    // An unconfigured helper does not pin.
    {
      code: `
        it('refuses', async () => {
          await expectRejectsDomainError(service.find(id), { type: NotFoundError, appCode: 'EMPLOYEE_NOT_FOUND' });
          await expect(service.find(id)).rejects.toThrow('Employee not found.');
        });
      `,
      errors: [{ messageId: 'messageOnlyThrow' }],
    },
    // Outside a test callback (a shared helper) it still reports.
    {
      code: 'export async function expectRefusal(p) { await expect(p).rejects.toThrow(); }',
      errors: [{ messageId: 'bareThrow' }],
    },
  ],
});
