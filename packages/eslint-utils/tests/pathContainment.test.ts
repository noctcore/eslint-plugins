import type { TSESLint, TSESTree } from '@typescript-eslint/utils';
import { Linter, type Rule } from 'eslint';
import { describe, expect, it } from 'vitest';

import {
  containmentGuard,
  isContainedBefore,
  isExitGuard,
  type PathContainmentContext,
} from '../src/pathContainment';

const PATH_FUNCTIONS = new Set(['relative', 'isAbsolute', 'resolve']);

function containmentFor(sourceCode: Readonly<TSESLint.SourceCode>): PathContainmentContext {
  return {
    sourceCode,
    pathFunction: (callee) => {
      const name =
        callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
          ? callee.property.name
          : callee.type === 'Identifier'
            ? callee.name
            : null;
      return name !== null && PATH_FUNCTIONS.has(name) ? name : null;
    },
    isPathSep: (node) => sourceCode.getText(node) === 'path.sep' || sourceCode.getText(node) === 'sep',
    holdsResolved: (node) => node.type === 'Identifier' && node.name === 'full',
    fixedBase: (node) => !sourceCode.getText(node).includes('input'),
    isGuardCall: (node) =>
      node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'isInside',
  };
}

/** Reports each `sink(...)` call that no containment test of `full` guards. */
const rule: Rule.RuleModule = {
  create(context) {
    const sourceCode = context.sourceCode as unknown as Readonly<TSESLint.SourceCode>;
    const containment = containmentFor(sourceCode);
    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'sink') {
          if (!isContainedBefore(node as unknown as TSESTree.Node, containment)) {
            context.report({ node, message: 'unguarded' });
          }
        }
      },
    };
  },
};

/** Reports each `if` that exits when `full` is outside. */
const exitRule: Rule.RuleModule = {
  create(context) {
    const sourceCode = context.sourceCode as unknown as Readonly<TSESLint.SourceCode>;
    const guard = containmentGuard(containmentFor(sourceCode));
    return {
      IfStatement(node) {
        if (isExitGuard(node as unknown as TSESTree.Node, guard, sourceCode)) {
          context.report({ node, message: 'exit guard' });
        }
      },
    };
  },
};

function lint(body: string, ruleModule: Rule.RuleModule): Linter.LintMessage[] {
  const linter = new Linter();
  const code = `function h(input) {\n  const full = path.resolve(BASE, input);\n${body}\n}`;
  const messages = linter.verify(code, {
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { test: { rules: { containment: ruleModule } } },
    rules: { 'test/containment': 'error' },
  });
  expect(messages.filter((message) => message.ruleId !== 'test/containment')).toEqual([]);
  return messages;
}

function contained(body: string): boolean {
  return lint(body, rule).length === 0;
}

describe('isContainedBefore', () => {
  it.each([
    [
      'an if that exits when outside',
      "if (!full.startsWith(BASE + path.sep)) throw new Error('outside');\nsink(full);",
    ],
    ['an if around the sink', 'if (full.startsWith(BASE + path.sep)) sink(full);'],
    ['a ternary around the sink', 'return full.startsWith(`${BASE}/`) ? sink(full) : null;'],
    ['an && before the sink', 'return full.startsWith(BASE + sep) && sink(full);'],
    ['an || before the sink', 'return !full.startsWith(BASE + sep) || sink(full);'],
    ['a const boolean', 'const ok = full.startsWith(BASE + path.sep);\nif (!ok) return;\nsink(full);'],
    ['a literal base with a separator', "if (!full.startsWith('/srv/data/')) return;\nsink(full);"],
    [
      'relative refused when it climbs or is absolute',
      "const rel = path.relative(BASE, full);\nif (rel.startsWith('..') || path.isAbsolute(rel)) return;\nsink(full);",
    ],
    [
      'relative refused as .. and ../ and absolute',
      "const rel = path.relative(BASE, full);\nif (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return;\nsink(full);",
    ],
    ['a guard call as the test', 'if (!isInside(BASE, full)) return;\nsink(full);'],
    [
      'one inline relative call refused three ways',
      "if (path.relative(BASE, full) === '..' || path.relative(BASE, full).startsWith('..' + sep) || path.isAbsolute(path.relative(BASE, full))) return;\nsink(full);",
    ],
    ['a guard call as a statement', 'isInside(BASE, full);\nsink(full);'],
  ])('accepts %s', (_name, body) => {
    expect(contained(body)).toBe(true);
  });

  it.each([
    ['no test', 'sink(full);'],
    ['an ignored test', 'full.startsWith(BASE + path.sep);\nsink(full);'],
    ['a test that guards another statement', "if (full.startsWith(BASE + path.sep)) log('inside');\nsink(full);"],
    ['a test after the sink', "sink(full);\nif (!full.startsWith(BASE + path.sep)) throw new Error('outside');"],
    [
      'a test in a nested function',
      "const check = () => { if (!full.startsWith(BASE + path.sep)) throw new Error('outside'); };\nsink(full);",
    ],
    ['a base with no separator', "if (!full.startsWith(BASE)) throw new Error('outside');\nsink(full);"],
    ['a literal base with no separator', "if (!full.startsWith('/srv/data')) return;\nsink(full);"],
    ['a separator alone', 'if (!full.startsWith(path.sep)) return;\nsink(full);'],
    ['the root directory', "if (!full.startsWith('/')) return;\nsink(full);"],
    ['a base the input picks', 'if (!full.startsWith(input + path.sep)) return;\nsink(full);'],
    ['an untested relative', 'path.relative(BASE, full);\nsink(full);'],
    [
      'relative with no absolute check',
      "const rel = path.relative(BASE, full);\nif (rel.startsWith('..')) return;\nsink(full);",
    ],
    [
      'relative refused only as ..',
      "const rel = path.relative(BASE, full);\nif (rel === '..' || path.isAbsolute(rel)) return;\nsink(full);",
    ],
    [
      'relative to the root',
      "const rel = path.relative('/', full);\nif (rel.startsWith('..') || path.isAbsolute(rel)) return;\nsink(full);",
    ],
    [
      'relative to the working directory',
      "const rel = path.relative(process.cwd(), full);\nif (rel.startsWith('..') || path.isAbsolute(rel)) return;\nsink(full);",
    ],
    ['an if that does not exit', "if (!full.startsWith(BASE + path.sep)) log('outside');\nsink(full);"],
    [
      'refusals of two different inline relative calls',
      "if (path.relative(BASE + '/sub', full) === '..' || path.relative(BASE, full).startsWith('..' + sep) || path.isAbsolute(path.relative(BASE, full))) return;\nsink(full);",
    ],
    [
      'refusals of inline relative calls that may differ on each run',
      "if (path.relative(next(), full).startsWith('..') || path.isAbsolute(path.relative(next(), full))) return;\nsink(full);",
    ],
  ])('rejects %s', (_name, body) => {
    expect(contained(body)).toBe(false);
  });
});

describe('isExitGuard', () => {
  it.each([
    ['a throw when outside', "if (!full.startsWith(BASE + path.sep)) throw new Error('outside');"],
    ['a return through a const boolean', 'const ok = full.startsWith(BASE + path.sep);\nif (!ok) return;'],
    ['a relative refusal', "const rel = path.relative(BASE, full);\nif (rel.startsWith('..') || path.isAbsolute(rel)) return;"],
  ])('accepts %s', (_name, body) => {
    expect(lint(body, exitRule)).toHaveLength(1);
  });

  it.each([
    ['an if that does not exit', "if (!full.startsWith(BASE + path.sep)) log('outside');"],
    ['an if with an else', "if (!full.startsWith(BASE + path.sep)) return;\nelse log('inside');"],
    ['an exit when inside', 'if (full.startsWith(BASE + path.sep)) return;'],
    ['a base with no separator', 'if (!full.startsWith(BASE)) return;'],
  ])('rejects %s', (_name, body) => {
    expect(lint(body, exitRule)).toHaveLength(0);
  });
});
