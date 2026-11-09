import { parseForESLint } from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import {
  calleePath,
  enclosingFunction,
  forEachDescendant,
  isSelfOrAncestor,
  runnerName,
  unwrapTypeWrappers,
  walkSome,
  type VisitorKeys,
} from '../src/ast';

/** Parse `code` and set `parent` on every node, as ESLint does before rules run. */
function parse(code: string): { ast: TSESTree.Program; keys: VisitorKeys } {
  const { ast, visitorKeys } = parseForESLint(code, { range: true, loc: true });
  const keys = visitorKeys as VisitorKeys;
  const program = ast as TSESTree.Program;
  const stack: TSESTree.Node[] = [program];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    for (const key of keys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key);
      const children = Array.isArray(value) ? value : [value];
      for (const child of children) {
        if (typeof child === 'object' && child !== null && 'type' in child) {
          Reflect.set(child, 'parent', node);
          stack.push(child as TSESTree.Node);
        }
      }
    }
  }
  return { ast: program, keys };
}

function firstOfType<T extends TSESTree.Node>(code: string, type: AST_NODE_TYPES): { node: T; keys: VisitorKeys } {
  const { ast, keys } = parse(code);
  let found: TSESTree.Node | undefined;
  walkSome(ast, keys, (node) => {
    if (node.type === type) {
      found = node;
      return true;
    }
    return false;
  });
  if (found === undefined) {
    throw new Error(`no ${type} in ${code}`);
  }
  return { node: found as T, keys };
}

function callee(code: string): TSESTree.Node {
  return firstOfType<TSESTree.CallExpression>(code, AST_NODE_TYPES.CallExpression).node.callee;
}

describe('calleePath', () => {
  it.each([
    ['fetch(url)', 'fetch'],
    ['undici.request(url)', 'undici.request'],
    ['client.http.get(url)', 'client.http.get'],
    ['client[method](url)', null],
    ['make().get(url)', null],
    ['this.logger.info(x)', null],
  ])('%s gives %s', (code, expected) => {
    expect(calleePath(callee(code))).toBe(expected);
  });

  it('accepts a chain rooted at `this` with allowThis', () => {
    expect(calleePath(callee('this.auditService.log(x)'), { allowThis: true })).toBe('this.auditService.log');
  });
});

describe('runnerName', () => {
  it.each([
    ['it("x", () => {})', 'it'],
    ['test.concurrent("x", () => {})', 'test'],
    ['describe.each(table)("x", () => {})', 'describe'],
    ['test.each`a`("x", () => {})', 'test'],
    ['(0, it)("x", () => {})', null],
  ])('%s gives %s', (code, expected) => {
    expect(runnerName(callee(code))).toBe(expected);
  });
});

describe('enclosingFunction', () => {
  it('returns the nearest function and null at module scope', () => {
    const { node } = firstOfType<TSESTree.Identifier>(
      'function outer() { const inner = () => target; }',
      AST_NODE_TYPES.ArrowFunctionExpression,
    );
    const target = (node as unknown as TSESTree.ArrowFunctionExpression).body;
    expect(enclosingFunction(target)).toBe(node);
    const top = firstOfType<TSESTree.Identifier>('const x = y;', AST_NODE_TYPES.Identifier).node;
    expect(enclosingFunction(top)).toBeNull();
  });
});

describe('walkers', () => {
  it('forEachDescendant visits the root and every child', () => {
    const { ast, keys } = parse('a(b, c);');
    const names: string[] = [];
    forEachDescendant(ast, keys, (node) => {
      if (node.type === AST_NODE_TYPES.Identifier) {
        names.push(node.name);
      }
    });
    expect(names.sort()).toEqual(['a', 'b', 'c']);
  });

  it('isSelfOrAncestor walks parent links up to the Program', () => {
    const { node } = firstOfType<TSESTree.CallExpression>('f(g(x));', AST_NODE_TYPES.CallExpression);
    const inner = node.arguments[0] as TSESTree.Node;
    expect(isSelfOrAncestor(node, inner)).toBe(true);
    expect(isSelfOrAncestor(inner, node)).toBe(false);
  });
});

describe('unwrapTypeWrappers', () => {
  it('peels as, satisfies and non-null wrappers', () => {
    const { node } = firstOfType<TSESTree.VariableDeclarator>(
      'const v = (x as unknown satisfies object)!;',
      AST_NODE_TYPES.VariableDeclarator,
    );
    const inner = unwrapTypeWrappers(node.init as TSESTree.Node);
    expect(inner.type).toBe(AST_NODE_TYPES.Identifier);
  });
});
