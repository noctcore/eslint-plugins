/**
 * Proves the doc-example checks reject what they claim to reject. Each case
 * feeds a small doc to a toy rule and asserts the exact problem, so a check
 * that quietly stops firing fails here rather than letting every doc pass.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  collectDocProblems,
  compareRulesToDocs,
  docLinterVersion,
  eslintVersion,
  expectedEslintMajor,
  parseDocExamples,
} from '../src';

/** Reports every `debugger`, except in files under `scripts/` or when `allow` is set. */
const noDebugger = {
  meta: {
    type: 'problem',
    schema: [{ type: 'object', properties: { allow: { type: 'boolean' } }, additionalProperties: false }],
    messages: { debugger: 'no debugger' },
  },
  create(context: {
    filename: string;
    options: readonly { allow?: boolean }[];
    report(descriptor: { node: unknown; messageId: string }): void;
  }) {
    if (context.filename.includes('scripts/') || context.options[0]?.allow === true) return {};
    return {
      DebuggerStatement(node: unknown): void {
        context.report({ node, messageId: 'debugger' });
      },
    };
  },
};

const plugin = { rules: { 'no-debugger': noDebugger } };

const fence = (info: string, code: string): string => `\`\`\`${info}\n${code}\n\`\`\``;
const doc = (...blocks: string[]): string => `# rule\n\n${blocks.join('\n\n')}\n`;
const problems = (markdown: string): string[] => collectDocProblems(plugin, 'no-debugger', markdown);

const BAD = fence('ts bad', 'debugger;');
const GOOD = fence('ts good', 'const x = 1;');

describe('doc example runtime', () => {
  it(`lints with ESLint ${expectedEslintMajor}, the same copy RuleTester runs`, () => {
    expect(docLinterVersion.split('.')[0]).toBe(expectedEslintMajor);
    expect(docLinterVersion).toBe(eslintVersion);
  });
});

describe('collectDocProblems', () => {
  it('accepts a bad example the rule reports and a good one it does not', () => {
    expect(problems(doc(BAD, GOOD))).toEqual([]);
  });

  it('rejects a doc with no good example', () => {
    expect(problems(doc(BAD))).toEqual([
      'needs at least one bad and one good example (has 1 bad, 0 good), or a prose example with a reason',
    ]);
  });

  it('rejects a doc with no bad example', () => {
    expect(problems(doc(GOOD))).toEqual([
      'needs at least one bad and one good example (has 0 bad, 1 good), or a prose example with a reason',
    ]);
  });

  it('rejects a ts fence with no label', () => {
    expect(problems(doc(BAD, GOOD, fence('ts', 'debugger;')))).toEqual([
      'line 11: `ts` fence has no bad / good / prose label',
    ]);
  });

  it('leaves an unlabelled config fence alone', () => {
    expect(problems(doc(BAD, GOOD, fence('js', "'no-debugger': 'error'")))).toEqual([]);
  });

  it('accepts a prose example that states a reason, and rejects one that does not', () => {
    expect(problems(doc(fence('ts prose reason="needs two files on disk"', 'debugger;')))).toEqual([]);
    expect(problems(doc(fence('ts prose', 'debugger;')))).toEqual([
      'line 3: a prose example must state why it is not executed (reason="...")',
      'needs at least one bad and one good example (has 0 bad, 0 good), or a prose example with a reason',
    ]);
  });

  it('accepts a prose example in any language, but runs bad and good ones only as code', () => {
    expect(problems(doc(fence('text prose reason="a file tree"', 'src/\n  a.ts')))).toEqual([]);
    expect(problems(doc(BAD, GOOD, fence('text good', 'src/')))).toEqual([
      'line 11: a good example must be ts, tsx, js or jsx, not `text`',
    ]);
  });

  it('rejects a bad example the rule does not report', () => {
    expect(problems(doc(fence('ts bad', 'const x = 1;'), GOOD))).toEqual([
      'line 3 (bad, src/example.ts): bad example drew no report from no-debugger',
    ]);
  });

  it('rejects a bad example that only fails to parse', () => {
    const [problem] = problems(doc(fence('ts bad', 'const = ;'), GOOD));
    expect(problem).toMatch(/^line 3 \(bad, src\/example\.ts\): bad example does not parse:/);
  });

  it('rejects a good example the rule reports', () => {
    expect(problems(doc(BAD, fence('ts good', 'debugger;')))).toEqual([
      'line 7 (good, src/example.ts): good example drew 1 message(s):\n  1: doc/no-debugger: no debugger',
    ]);
  });

  it('rejects a good example that does not parse', () => {
    const [problem] = problems(doc(BAD, fence('ts good', 'const = ;')));
    expect(problem).toMatch(/^line 7 \(good, src\/example\.ts\): good example drew 1 message\(s\):\n {2}\d+: fatal:/);
  });

  it('holds a bad example to its pinned report count', () => {
    expect(problems(doc(fence('ts bad reports=2', 'debugger;\ndebugger;'), GOOD))).toEqual([]);
    expect(problems(doc(fence('ts bad reports=3', 'debugger;\ndebugger;'), GOOD))).toEqual([
      'line 3 (bad, src/example.ts): bad example claims 3 report(s) but drew 2:\n  1: doc/no-debugger: no debugger\n  2: doc/no-debugger: no debugger',
    ]);
  });

  it('rejects a good example that escapes the rule by moving file, unless marked relocation', () => {
    const moved = fence('ts good filename=scripts/debug.ts', 'debugger;');
    expect(problems(doc(BAD, moved))).toEqual([
      'line 7: good example runs as scripts/debug.ts, which no bad example uses; a different file only counts as the fix when marked `relocation`',
    ]);
    expect(problems(doc(BAD, fence('ts good filename=scripts/debug.ts relocation', 'debugger;')))).toEqual([]);
  });

  it('rejects a stale relocation marker', () => {
    expect(problems(doc(BAD, fence('ts good relocation', 'const x = 1;')))).toEqual([
      'line 7: marked `relocation` but runs as the same file as a bad example',
    ]);
  });

  it('rejects a good example that escapes the rule by changing options, unless marked reconfigured', () => {
    expect(problems(doc(BAD, fence('ts good options={"allow":true}', 'debugger;')))).toEqual([
      'line 7: good example uses options no bad example uses; different options only count as the fix when marked `reconfigured`',
    ]);
    expect(problems(doc(BAD, fence('ts good options={"allow":true} reconfigured', 'debugger;')))).toEqual([]);
  });

  it('passes options to the rule', () => {
    expect(problems(doc(fence('ts bad options={"allow":true}', 'debugger;'), GOOD))).toContain(
      'line 3 (bad, src/example.ts): bad example drew no report from no-debugger',
    );
  });

  it('rejects unknown attributes and misplaced ones', () => {
    expect(problems(doc(fence('ts bad colour=red relocation', 'debugger;'), GOOD))).toEqual([
      'line 3: unknown fence attribute `colour=red`',
      'line 3: relocation only belongs on a good example',
    ]);
  });

  it('rejects options the rule schema does not allow', () => {
    const bad = fence('ts bad options={"allowed":true}', 'debugger;');
    const good = fence('ts good options={"allowed":true}', 'const x = 1;');
    expect(problems(doc(bad, good))).toEqual([
      expect.stringMatching(/^line 3 \(bad, src\/example\.ts\): ESLint rejected the example: .*doc\/no-debugger/s),
      expect.stringMatching(/^line 7 \(good, src\/example\.ts\): ESLint rejected the example: .*doc\/no-debugger/s),
    ]);
  });

  it('rejects options that are not JSON', () => {
    expect(problems(doc(fence('ts bad options={allow:true}', 'debugger;'), GOOD))[0]).toMatch(
      /^line 3: options is not valid JSON \(\{allow:true\}\)/,
    );
  });
});

describe('parseDocExamples', () => {
  it('reads filename, options with spaces, flags and a quoted reason', () => {
    const { blocks, problems: found } = parseDocExamples(
      doc(
        fence('tsx good filename=src/ui/Button.tsx options={"allow": [ "a b" ]} relocation reconfigured', '<a />'),
        fence('ts prose reason="it reads \\"package.json\\""', 'x'),
      ),
    );
    expect(found).toEqual([]);
    expect(blocks.map(({ kind, lang, filename, options, relocation, reconfigured, reason, line }) => ({
      kind, lang, filename, options, relocation, reconfigured, reason, line,
    }))).toEqual([
      {
        kind: 'good',
        lang: 'tsx',
        filename: 'src/ui/Button.tsx',
        options: [{ allow: ['a b'] }],
        relocation: true,
        reconfigured: true,
        reason: undefined,
        line: 3,
      },
      {
        kind: 'prose',
        lang: 'ts',
        filename: 'src/example.ts',
        options: [],
        relocation: false,
        reconfigured: false,
        reason: 'it reads "package.json"',
        line: 7,
      },
    ]);
  });
});

describe('compareRulesToDocs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'noctcore-docs-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('names a rule with no doc and a doc with no rule', () => {
    writeFileSync(join(dir, 'no-debugger.md'), '# doc');
    writeFileSync(join(dir, 'retired-rule.md'), '# doc');
    writeFileSync(join(dir, 'notes.txt'), 'not a doc');
    const withExtra = { rules: { ...plugin.rules, 'new-rule': noDebugger } };
    expect(compareRulesToDocs(withExtra, dir)).toEqual({
      undocumented: ['new-rule'],
      orphaned: ['retired-rule'],
    });
  });
});
