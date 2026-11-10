import { parseForESLint } from '@typescript-eslint/parser';
import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import { fetchCalleeText, matchFetchCallee, normalizeFetchCallees, toFetchCalleeSpec } from '../src/fetchCallee';

/** The first call in `code`, plus a source-code stand-in that only needs `getText`. */
function firstCall(code: string): { call: TSESTree.CallExpression; sourceCode: Readonly<TSESLint.SourceCode> } {
  const { ast } = parseForESLint(code, { range: true, loc: true });
  const statement = ast.body[0] as TSESTree.ExpressionStatement;
  const sourceCode = {
    getText: (node: TSESTree.Node) => code.slice(node.range[0], node.range[1]),
  } as unknown as Readonly<TSESLint.SourceCode>;
  return { call: statement.expression as TSESTree.CallExpression, sourceCode };
}

describe('toFetchCalleeSpec', () => {
  it.each([
    ['fetch', { name: 'fetch' }],
    ['http.fetchWithRetry', { object: 'http', name: 'fetchWithRetry' }],
    ['this.api.get', { object: 'this.api', name: 'get' }],
    [' axios . post ', { object: 'axios', name: 'post' }],
  ])('%s', (entry, expected) => {
    expect(toFetchCalleeSpec(entry)).toEqual(expected);
  });

  it('keeps the object form as given', () => {
    const spec = { name: 'get', object: 'axios', urlProperty: 'url' };
    expect(toFetchCalleeSpec(spec)).toBe(spec);
  });
});

describe('matchFetchCallee', () => {
  const specs = normalizeFetchCallees(['fetch', 'axios.get', 'this.http.request', { name: 'send', object: 'client' }]);

  it.each([
    ['fetch(url);', 'fetch'],
    ['axios.get(url);', 'axios.get'],
    ['this.http.request(url);', 'this.http.request'],
    ['client.send(url);', 'client.send'],
  ])('matches %s', (code, expected) => {
    const { call, sourceCode } = firstCall(code);
    const spec = matchFetchCallee(call, specs, sourceCode);
    expect(spec === undefined ? null : fetchCalleeText(spec)).toBe(expected);
  });

  it.each(['get(url);', 'axios.post(url);', 'other.fetch(url);', "axios['get'](url);", 'make().get(url);'])(
    'does not match %s',
    (code) => {
      const { call, sourceCode } = firstCall(code);
      expect(matchFetchCallee(call, specs, sourceCode)).toBeUndefined();
    },
  );
});
