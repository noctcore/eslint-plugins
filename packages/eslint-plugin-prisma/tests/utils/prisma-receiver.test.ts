import { parse } from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CLIENT_PROPERTIES,
  DEFAULT_RECEIVER_PATTERN,
  DEFAULT_TX_ROOT_NAMES,
  DEFAULT_UNSCOPED_PROPERTY,
  isPrismaLikeReceiver,
  receiverLooksLikePrisma,
  resolveReceiverOptions,
} from '../../src/utils/prisma-receiver';

/** The receiver (`callee.object`) of the single call expression in `code`. */
function receiverOf(code: string): TSESTree.Node {
  const statement = parse(code).body[0];
  if (
    statement?.type !== AST_NODE_TYPES.ExpressionStatement ||
    statement.expression.type !== AST_NODE_TYPES.CallExpression ||
    statement.expression.callee.type !== AST_NODE_TYPES.MemberExpression
  ) {
    throw new Error(`not a member call: ${code}`);
  }
  return statement.expression.callee.object;
}

describe('resolveReceiverOptions', () => {
  it('applies the documented defaults', () => {
    const resolved = resolveReceiverOptions({});
    expect(DEFAULT_RECEIVER_PATTERN).toBe('prisma');
    expect(resolved.receiverPattern.flags).toContain('i');
    expect(resolved.unscopedProperty).toBe(DEFAULT_UNSCOPED_PROPERTY);
    expect([...resolved.clientProperties]).toEqual([...DEFAULT_CLIENT_PROPERTIES]);
    expect([...resolved.txRootNames]).toEqual([...DEFAULT_TX_ROOT_NAMES]);
  });
});

describe('receiverLooksLikePrisma', () => {
  const defaults = resolveReceiverOptions({});

  it.each([
    'prisma.invoice.create()',
    'this.prismaService.invoice.create()',
    'this.PRISMA.invoice.create()',
    'tx.invoice.create()',
  ])('accepts %s by default', (code) => {
    expect(receiverLooksLikePrisma(receiverOf(code), defaults)).toBe(true);
  });

  it.each(['this.client.invoice.create()', 'this.cache.delete()', "createHash('x').update()"])(
    'rejects %s by default',
    (code) => {
      expect(receiverLooksLikePrisma(receiverOf(code), defaults)).toBe(false);
    },
  );

  it('ignores a computed property even when its identifier matches', () => {
    expect(receiverLooksLikePrisma(receiverOf('this[prisma].create()'), defaults)).toBe(false);
  });

  it('honours clientProperties, txRootNames and receiverPattern', () => {
    const custom = resolveReceiverOptions({
      receiverPattern: '^db$',
      clientProperties: ['client'],
      txRootNames: ['trx'],
    });
    expect(receiverLooksLikePrisma(receiverOf('this.client.invoice.create()'), custom)).toBe(true);
    expect(receiverLooksLikePrisma(receiverOf('trx.invoice.create()'), custom)).toBe(true);
    expect(receiverLooksLikePrisma(receiverOf('db.invoice.create()'), custom)).toBe(true);
    expect(receiverLooksLikePrisma(receiverOf('tx.invoice.create()'), custom)).toBe(false);
    expect(receiverLooksLikePrisma(receiverOf('prisma.invoice.create()'), custom)).toBe(false);
  });
});

describe('isPrismaLikeReceiver', () => {
  it('matches an identifier or a member property, not a call result', () => {
    const defaults = resolveReceiverOptions({});
    expect(isPrismaLikeReceiver(receiverOf('prisma.x()'), defaults)).toBe(true);
    expect(isPrismaLikeReceiver(receiverOf('this.prismaService.x()'), defaults)).toBe(true);
    expect(isPrismaLikeReceiver(receiverOf('getPrisma().x()'), defaults)).toBe(false);
  });
});
