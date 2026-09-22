import { ruleTester } from '@noctcore/eslint-test-utils';

import { moneyMustBeDecimalRule } from '../../src/rules/money-must-be-decimal';

ruleTester.run('money-must-be-decimal', moneyMustBeDecimalRule, {
  valid: [
    // Money name but typed as the domain money type: the desired shape.
    { code: 'const total: Decimal = sum;' },
    { code: 'class Invoice { total: Decimal; }' },
    // Non-money names typed as number are fine.
    { code: 'const count: number = 3;' },
    { code: 'const userName: string = "x";' },
    { code: 'class Widget { quantity: number; }' },
    // Money name but UNTYPED: must NOT flag (no annotation to inspect).
    { code: 'let total = 0;' },
    { code: 'class Cart { total = 0; }' },
    // Money name with a numeric-literal initializer but no annotation. The
    // initializer branch is intentionally NOT implemented (would catch
    // accumulators), so this stays valid.
    { code: 'const x = { total: 5 };' },
    { code: 'const balance = 100;' },
    // Interface / type-literal members are intentionally out of scope.
    { code: 'interface Payment { amount: number; }' },
    { code: 'type Progress = { total: number; transferred: number };' },
    // Allowlisted file by path suffix is skipped entirely.
    {
      code: 'class Legacy { total: number; }',
      options: [{ allowedFiles: ['apps/api/src/legacy/legacy.service.ts'] }],
      filename: 'apps/api/src/legacy/legacy.service.ts',
    },
    // Custom fieldPatterns that do not match the field name leave it valid.
    {
      code: 'class Order { total: number; }',
      options: [{ fieldPatterns: ['amount', 'price'] }],
    },
    // A Stripe-style integer amount in minor units, declared as such.
    {
      code: 'class PaymentIntent { amount: number; }',
      options: [{ minorUnitPatterns: ['^amount$'] }],
    },
    {
      code: 'const unitAmount: number = 1999;',
      options: [{ minorUnitPatterns: ['^amount$', '^unitAmount$'] }],
    },
    // A suffix convention exempts every field that carries it, case-insensitively.
    {
      code: 'class Charge { amountCents: number; totalInCents: number; }',
      options: [{ minorUnitPatterns: ['cents$'] }],
    },
  ],
  invalid: [
    // The canonical case: a class property named like money, typed number.
    {
      code: 'class Invoice { total: number; }',
      errors: [{ messageId: 'moneyMustBeDecimal' }],
    },
    // Annotated variable declarator named like money, typed number.
    {
      code: 'const amount: number = 5;',
      errors: [{ messageId: 'moneyMustBeDecimal' }],
    },
    // Other default-pattern money names.
    {
      code: 'class Invoice { price: number; }',
      errors: [{ messageId: 'moneyMustBeDecimal' }],
    },
    {
      code: 'class LineItem { cost: number; balance: number; }',
      errors: [{ messageId: 'moneyMustBeDecimal' }, { messageId: 'moneyMustBeDecimal' }],
    },
    // Custom fieldPatterns can flag a name the default pattern would miss.
    {
      code: 'class Tx { discount: number; }',
      options: [{ fieldPatterns: ['discount'] }],
      errors: [{ messageId: 'moneyMustBeDecimal' }],
    },
    // An anchored minor-unit pattern exempts only the field it names.
    {
      code: 'class Invoice { amount: number; totalAmount: number; }',
      options: [{ minorUnitPatterns: ['^amount$'] }],
      errors: [{ messageId: 'moneyMustBeDecimal', line: 1, column: 33 }],
    },
    // An empty list exempts nothing: the default behaviour.
    {
      code: 'class PaymentIntent { amount: number; }',
      options: [{ minorUnitPatterns: [] }],
      errors: [{ messageId: 'moneyMustBeDecimal' }],
    },
    // A minor-unit pattern does not widen what counts as money: `discount` is
    // still only flagged because a custom fieldPatterns names it.
    {
      code: 'class Tx { discount: number; discountCents: number; }',
      options: [{ fieldPatterns: ['discount'], minorUnitPatterns: ['cents$'] }],
      errors: [{ messageId: 'moneyMustBeDecimal', column: 12 }],
    },
    // Custom decimalType flows into the message data.
    {
      code: 'const total: number = 5;',
      options: [{ decimalType: 'Money' }],
      errors: [{ messageId: 'moneyMustBeDecimal' }],
    },
  ],
});
