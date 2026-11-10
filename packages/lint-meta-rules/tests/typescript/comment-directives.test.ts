import { describe, expect, test } from 'bun:test';

import { createNoInlineLintDisableRule, createNoTsIgnoreRule } from '../../src/typescript';
import { createFixture, messages, runSync } from '../test-utils/diskFixture';

/*
 * Cases ported from the consumer repos' `forbidden-text` rule suites, which
 * these two factories replace, plus the options the published rules add.
 */

function files(violations: readonly { file: string }[]): string[] {
  return violations.map((violation) => violation.file.split('/').pop() ?? '').sort();
}

describe('no-inline-lint-disable', () => {
  const rule = createNoInlineLintDisableRule();

  test('reports each inline eslint-disable form, with its line', () => {
    const fixture = createFixture({
      'apps/api/src/next-line.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n',
      'apps/api/src/block.ts': '/* eslint-disable */\nexport const a = 1;\n',
      'apps/api/src/same-line.ts': 'export const b = 2;\nconsole.log(1); // eslint-disable-line no-console\n',
    });
    const violations = runSync(rule, fixture.context());
    expect(files(violations)).toEqual(['block.ts', 'next-line.ts', 'same-line.ts']);
    const sameLine = violations.find((violation) => violation.file.endsWith('same-line.ts'));
    expect(sameLine?.line).toBe(2);
    expect(sameLine?.message).toContain('`eslint-disable-line`');
  });

  test('passes clean source, including a file that only mentions eslint', () => {
    const fixture = createFixture({ 'apps/api/src/clean.ts': "export const note = 'run eslint before you push';\n" });
    expect(runSync(rule, fixture.context())).toEqual([]);
  });

  test('skips generated output, which legitimately carries blanket suppressions', () => {
    const banner = '/* eslint-disable */\nexport const generated = true;\n';
    const fixture = createFixture({
      'apps/web/src/routeTree.gen.ts': banner,
      'apps/api/src/@generated/server.ts': banner,
      'packages/database/src/generated/client.ts': banner,
    });
    expect(runSync(rule, fixture.context())).toEqual([]);
  });

  test('reports a block directive whose first line carries it', () => {
    const fixture = createFixture({ 'apps/api/src/multi.ts': '/*\n eslint-disable no-console\n*/\nconsole.log(1);\n' });
    expect(runSync(rule, fixture.context())).toHaveLength(1);
  });

  test('passes text that names a directive without being one', () => {
    const fixture = createFixture({
      'apps/api/src/pattern.ts': 'export const P = /eslint-disable(-next-line)?/u;\n',
      'apps/api/src/message.ts': "export const M = 'Inline eslint-disable is not allowed.';\n",
      'apps/api/src/fixture.ts': "const bad = '// eslint-disable-next-line no-console';\nexport { bad };\n",
      'apps/api/src/prose.ts': '/** Rejects `// eslint-disable` directives in source. */\nexport const a = 1;\n',
      'apps/api/src/template.ts': 'const t = `${a} // eslint-disable`;\nexport { t };\n',
      'apps/web/src/jsx.tsx': 'export const A = () => <p>// eslint-disable-next-line</p>;\n',
      'apps/api/src/enable.ts': '/* eslint-enable */\nexport const e = 1;\n',
      'apps/api/src/disabled-word.ts': '// eslint-disabled for now? no.\nexport const d = 1;\n',
    });
    expect(runSync(rule, fixture.context())).toEqual([]);
  });

  test('still reports a directive further down, after a template with substitutions', () => {
    const fixture = createFixture({
      'apps/api/src/late.ts': 'const t = `x ${`y ${z} w`} v`;\nfoo();\n// eslint-disable-next-line no-console\nconsole.log(t);\n',
    });
    const violations = runSync(rule, fixture.context());
    expect(violations).toHaveLength(1);
    expect(violations[0]?.line).toBe(3);
  });

  test('honours allowedFiles and sourceGlobs', () => {
    const fixture = createFixture({
      'apps/api/src/vendor/legacy.js': '/* eslint-disable */\n',
      'apps/api/scripts/tool.ts': '// eslint-disable-next-line no-console\n',
      'apps/api/src/real.ts': '// eslint-disable-next-line no-console\n',
    });
    const violations = runSync(
      createNoInlineLintDisableRule({ allowedFiles: ['**/vendor/**'], sourceGlobs: ['apps/*/src/**/*.{ts,js}'] }),
      fixture.context(),
    );
    expect(files(violations)).toEqual(['real.ts']);
  });

  test('allowWithDescription lets a directive with a reason through', () => {
    const fixture = createFixture({
      'apps/api/src/reasoned.ts': '// eslint-disable-next-line no-console -- CLI output\nconsole.log(1);\n',
      'apps/api/src/bare.ts': '// eslint-disable-next-line no-console\nconsole.log(1);\n',
    });
    const violations = runSync(createNoInlineLintDisableRule({ allowWithDescription: true }), fixture.context());
    expect(files(violations)).toEqual(['bare.ts']);
    expect(messages(violations)[0]).toContain('description after ` -- `');
  });
});

describe('no-ts-ignore', () => {
  const rule = createNoTsIgnoreRule();

  test('reports both @ts-ignore and @ts-expect-error', () => {
    const fixture = createFixture({
      'apps/web/src/ignore.ts': '// @ts-ignore\nconst a: number = "x";\n',
      'apps/web/src/expect.tsx': '// @ts-expect-error legacy\nconst b: number = "x";\n',
    });
    const violations = runSync(rule, fixture.context());
    expect(files(violations)).toEqual(['expect.tsx', 'ignore.ts']);
    expect(violations.every((violation) => violation.rule === 'no-ts-ignore' && violation.line === 1)).toBe(true);
  });

  test('skips generated output', () => {
    const fixture = createFixture({ 'apps/web/src/routeTree.gen.ts': '// @ts-nocheck\n// @ts-ignore\nexport const x = 1;\n' });
    expect(runSync(rule, fixture.context())).toEqual([]);
  });

  test('passes a suppression named in prose, in a string or in a pattern', () => {
    const fixture = createFixture({
      'apps/web/src/pattern.ts': 'export const P = /@ts-(ignore|expect-error)/u;\n',
      'apps/web/src/fixture.ts': "const bad = '// @ts-ignore';\nexport { bad };\n",
      'apps/web/src/prose.tsx': '/** No `@ts-ignore` / `@ts-expect-error` suppressions. */\nexport const a = 1;\n',
      'apps/web/src/mid-sentence.ts': '/**\n * Never write @ts-ignore here. */\nexport const a = 1;\n',
      'apps/web/src/ignorance.ts': '// @ts-ignorance is bliss\nexport const a = 1;\n',
    });
    expect(runSync(rule, fixture.context())).toEqual([]);
  });

  test('still reports a directive that trails real code on the same line', () => {
    const fixture = createFixture({ 'apps/web/src/trailing.ts': 'const a: number = load(); // @ts-expect-error legacy\n' });
    expect(runSync(rule, fixture.context())).toHaveLength(1);
  });

  // tsc reads past a run of slashes or stars, and a block comment's last line (checked on tsc 5.9).
  test('reports every comment form tsc honours, and a directive with anything glued on', () => {
    const fixture = createFixture({
      'apps/web/src/triple-slash.ts': '/// @ts-ignore\nconst a: number = "x";\n',
      'apps/web/src/doc-comment.ts': '/** @ts-ignore */\nconst a: number = "x";\n',
      'apps/web/src/last-line.ts': '/* legacy\n@ts-ignore */\nconst a: number = "x";\n',
      'apps/web/src/starred-last-line.ts': '/**\n * @ts-expect-error */\nconst a: number = "x";\n',
      'apps/web/src/ignore-x.ts': '// @ts-ignoreX\nconst a: number = "x";\n',
      'apps/web/src/expect-errors.ts': '// @ts-expect-errors\nconst a: number = "x";\n',
    });
    expect(files(runSync(rule, fixture.context()))).toEqual([
      'doc-comment.ts',
      'expect-errors.ts',
      'ignore-x.ts',
      'last-line.ts',
      'starred-last-line.ts',
      'triple-slash.ts',
    ]);
  });

  test('reads a directive in the trivia before a doc comment that ends the file', () => {
    const fixture = createFixture({ 'apps/api/src/tail.ts': 'foo();\n// @ts-ignore\n/** trailing note */\n' });
    expect(runSync(rule, fixture.context())).toHaveLength(1);
  });

  test('allowExpectError reports only @ts-ignore; allowedFiles exempts type tests', () => {
    const fixture = createFixture({
      'apps/web/src/ignore.ts': '// @ts-ignore\nconst a: number = "x";\n',
      'apps/web/src/expect.ts': '// @ts-expect-error legacy\nconst b: number = "x";\n',
      'apps/web/src/types.test-d.ts': '// @ts-ignore\n// @ts-expect-error wrong arity\nf(1, 2);\n',
    });
    const allowExpect = runSync(
      createNoTsIgnoreRule({ allowExpectError: true, allowedFiles: ['**/*.test-d.ts'] }),
      fixture.context(),
    );
    expect(files(allowExpect)).toEqual(['ignore.ts']);
    const allowedOnly = runSync(createNoTsIgnoreRule({ allowedFiles: ['**/*.test-d.ts'] }), fixture.context());
    expect(files(allowedOnly)).toEqual(['expect.ts', 'ignore.ts']);
  });
});
