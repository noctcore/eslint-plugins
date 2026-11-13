import { parse } from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import { middlewarePath, routeCall } from '../../src/utils/router';

function callOf(code: string): TSESTree.CallExpression {
  const statement = parse(code).body[0];
  if (
    statement?.type !== AST_NODE_TYPES.ExpressionStatement ||
    statement.expression.type !== AST_NODE_TYPES.CallExpression
  ) {
    throw new Error(`not a call: ${code}`);
  }
  return statement.expression;
}

function argOf(code: string): TSESTree.CallExpressionArgument {
  const arg = callOf(`f(${code});`).arguments[0];
  if (arg === undefined) {
    throw new Error(`no argument: ${code}`);
  }
  return arg;
}

describe('routeCall', () => {
  it.each(['get', 'post', 'put', 'patch', 'delete', 'all'])('reads app.%s', (method) => {
    const call = routeCall(callOf(`app.${method}('/x', a, b, handler);`));
    expect(call?.method).toBe(method);
    expect(call?.chain).toHaveLength(3);
  });

  it.each([
    "app.head('/x', h);",
    "app['get']('/x', h);",
    'app.get(path, h);',
    'app.get(`/x/${id}`, h);',
    "app.get('/x');",
    "get('/x', h);",
  ])('returns null for %s', (code) => {
    expect(routeCall(callOf(code))).toBeNull();
  });

  it('accepts a template literal without expressions as the path', () => {
    expect(routeCall(callOf('app.get(`/x`, h);'))?.path.type).toBe(AST_NODE_TYPES.TemplateLiteral);
  });

  it.each(['router.get', 'this.app.get', 'new Thing().get'])('accepts the receiver of %s', (callee) => {
    expect(routeCall(callOf(`${callee}('/x', h);`))).not.toBeNull();
  });
});

describe('middlewarePath', () => {
  it.each([
    ['signedInOnly', 'signedInOnly'],
    ['auth.signedIn', 'auth.signedIn'],
    ['body(S)', 'body'],
    ['v.body(S)', 'v.body'],
  ])('names %s as %s', (code, expected) => {
    expect(middlewarePath(argOf(code))).toBe(expected);
  });

  it.each(['...mw', '() => {}', "'x'", 'a[b]', 'make()(x)'])('returns null for %s', (code) => {
    expect(middlewarePath(argOf(code))).toBeNull();
  });
});
