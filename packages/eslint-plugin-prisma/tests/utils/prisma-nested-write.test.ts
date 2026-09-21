import { parse } from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import { findNestedWrites } from '../../src/utils/prisma-nested-write';

/** The first argument of the first call in `code`. */
function firstArgument(code: string): TSESTree.Node | undefined {
  const program = parse(code);
  const statement = program.body[0];
  if (statement?.type !== AST_NODE_TYPES.ExpressionStatement) return undefined;
  const call = statement.expression;
  if (call.type !== AST_NODE_TYPES.CallExpression) return undefined;
  return call.arguments[0];
}

const RELATIONS = new Set(['invoices', 'issuedInvoices']);

describe('findNestedWrites', () => {
  it('finds a nested write under a guarded relation', () => {
    const found = findNestedWrites(
      firstArgument('client.account.update({ data: { invoices: { create: { total: 1 } } } })'),
      RELATIONS,
    );
    expect(found.map((write) => [write.relation, write.verb])).toEqual([['invoices', 'create']]);
  });

  it('descends through objects and arrays at any depth', () => {
    const found = findNestedWrites(
      firstArgument(
        'client.tenant.update({ data: { accounts: { update: [{ data: { issuedInvoices: { updateMany: {} } } }] } } })',
      ),
      RELATIONS,
    );
    expect(found.map((write) => write.relation)).toEqual(['issuedInvoices']);
  });

  it('ignores relinking verbs and unguarded relations', () => {
    expect(
      findNestedWrites(
        firstArgument('client.account.update({ data: { invoices: { connect: { id } }, notes: { create: {} } } })'),
        RELATIONS,
      ),
    ).toEqual([]);
  });

  it('cannot see a variable payload (the documented blind spot)', () => {
    expect(findNestedWrites(firstArgument('client.account.update(payload)'), RELATIONS)).toEqual([]);
  });
});
