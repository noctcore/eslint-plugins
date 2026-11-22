import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv-draft-04';
import addFormats from 'ajv-formats';
import { ESLint, type Linter } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

import plugin from '../src/index';
import formatSarif from '../src/sarif';
import {
  artifactLocation,
  buildSarifLog,
  securitySeverity,
  taxonomyTags,
  toFileUri,
  type SarifLog,
} from '../src/sarif-log';

type Docs = { cwe?: readonly string[]; owasp?: readonly string[]; securitySeverity?: number };
type RuleWithDocs = { meta: { docs: Docs } };

const rules = Object.entries(plugin.rules as Record<string, RuleWithDocs>);

const schema = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url)), 'utf8'),
) as object;
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSarif = ajv.compile(schema);

function expectValid(log: unknown): void {
  const valid = validateSarif(log);
  expect(validateSarif.errors ?? []).toEqual([]);
  expect(valid).toBe(true);
}

function message(overrides: Partial<Linter.LintMessage> = {}): Linter.LintMessage {
  return {
    ruleId: 'noctcore-security/no-shell-interpolation',
    severity: 2,
    message: 'Shell command built from a runtime value.',
    line: 3,
    column: 5,
    endLine: 3,
    endColumn: 20,
    ...overrides,
  } as Linter.LintMessage;
}

function lintResult(filePath: string, overrides: Partial<ESLint.LintResult> = {}): ESLint.LintResult {
  return {
    filePath,
    messages: [],
    suppressedMessages: [],
    errorCount: 0,
    fatalErrorCount: 0,
    warningCount: 0,
    fixableErrorCount: 0,
    fixableWarningCount: 0,
    usedDeprecatedRules: [],
    ...overrides,
  } as ESLint.LintResult;
}

const rulesMeta = Object.fromEntries(
  rules.map(([id, rule]) => [`noctcore-security/${id}`, rule.meta]),
) as unknown as ESLint.LintResultData['rulesMeta'];

const run = (log: SarifLog) => log.runs[0]!;

describe('rule taxonomy', () => {
  it.each(rules)('%s names at least one CWE as CWE-<n>', (_id, rule) => {
    const cwe = rule.meta.docs.cwe ?? [];
    expect(cwe.length).toBeGreaterThan(0);
    for (const id of cwe) {
      expect(id).toMatch(/^CWE-\d+$/u);
    }
  });

  it.each(rules)('%s names its OWASP Top 10 category as A<nn>:2021', (_id, rule) => {
    const owasp = rule.meta.docs.owasp ?? [];
    expect(owasp.length).toBeGreaterThan(0);
    for (const id of owasp) {
      expect(id).toMatch(/^A\d{2}:2021$/u);
    }
  });

  it.each(rules)('%s has a security severity between 0 and 10', (_id, rule) => {
    const score = rule.meta.docs.securitySeverity;
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(10);
  });
});

describe('taxonomyTags and securitySeverity', () => {
  it('pads CWE numbers to three digits the way code scanning tags them', () => {
    expect(taxonomyTags({ cwe: ['CWE-78', 'CWE-1004'], owasp: ['A03:2021'] })).toEqual([
      'security',
      'external/cwe/cwe-078',
      'external/cwe/cwe-1004',
      'external/owasp/a03:2021',
    ]);
  });

  it('returns nothing for docs without ids', () => {
    expect(taxonomyTags({ description: 'x' })).toEqual([]);
    expect(taxonomyTags(undefined)).toEqual([]);
  });

  it('writes the score with one decimal and drops scores out of range', () => {
    expect(securitySeverity({ securitySeverity: 9.8 })).toBe('9.8');
    expect(securitySeverity({ securitySeverity: 7 })).toBe('7.0');
    expect(securitySeverity({ securitySeverity: 11 })).toBeUndefined();
    expect(securitySeverity({ securitySeverity: '7' })).toBeUndefined();
    expect(securitySeverity(null)).toBeUndefined();
  });
});

describe('artifact locations', () => {
  it('is relative to a POSIX working directory under SRCROOT', () => {
    expect(artifactLocation('/repo/src/run.js', '/repo', false)).toEqual({
      uri: 'src/run.js',
      uriBaseId: 'SRCROOT',
    });
    expect(artifactLocation('/repo/src/a b#c.js', '/repo/', false)).toEqual({
      uri: 'src/a%20b%23c.js',
      uriBaseId: 'SRCROOT',
    });
  });

  it('is relative to a Windows working directory, with forward slashes and no case check', () => {
    expect(artifactLocation('C:\\Repo\\src\\run.js', 'c:\\repo', false)).toEqual({
      uri: 'src/run.js',
      uriBaseId: 'SRCROOT',
    });
  });

  it('is an absolute file URI outside the working directory or when asked', () => {
    expect(artifactLocation('/other/run.js', '/repo', false)).toEqual({ uri: 'file:///other/run.js' });
    expect(artifactLocation('/repo/src/run.js', '/repo', true)).toEqual({ uri: 'file:///repo/src/run.js' });
    expect(artifactLocation('C:\\repo\\src\\run.js', 'C:\\repo', true)).toEqual({
      uri: 'file:///C:/repo/src/run.js',
    });
    expect(artifactLocation('\\\\server\\share\\run.js', 'C:\\repo', false)).toEqual({
      uri: 'file://server/share/run.js',
    });
  });

  it('turns directories into file URIs that end with a slash', () => {
    expect(toFileUri('/repo', true)).toBe('file:///repo/');
    expect(toFileUri('C:\\repo\\', true)).toBe('file:///C:/repo/');
  });
});

describe('buildSarifLog', () => {
  it('is checked against a schema that rejects a broken log', () => {
    const log = buildSarifLog([], { cwd: '/repo', rulesMeta: {} }) as unknown as Record<string, unknown>;
    expect(validateSarif({ ...log, version: '2.0.0' })).toBe(false);
    expect(validateSarif({ ...log, runs: [{ results: [] }] })).toBe(false);
  });

  it('writes an empty run with empty results and rules', () => {
    const log = buildSarifLog([], { cwd: '/repo', rulesMeta: {} });
    expectValid(log);
    expect(log.version).toBe('2.1.0');
    expect(run(log).results).toEqual([]);
    expect(run(log).tool.driver.rules).toEqual([]);
    expect(run(log).invocations).toEqual([{ executionSuccessful: true, toolConfigurationNotifications: [] }]);
    expect(run(log).originalUriBaseIds).toEqual({ SRCROOT: { uri: 'file:///repo/' } });
  });

  it('survives missing data', () => {
    const log = buildSarifLog([lintResult('/x/a.js', { messages: [message()] })], undefined, { cwd: '/x' });
    expectValid(log);
    expect(run(log).tool.driver.rules).toEqual([{ id: 'noctcore-security/no-shell-interpolation' }]);
  });

  it('describes each reported rule once, with tags and security severity', () => {
    const log = buildSarifLog(
      [
        lintResult('/repo/a.js', { messages: [message(), message({ line: 9 })] }),
        lintResult('/repo/b.js', { messages: [message({ ruleId: 'no-console', severity: 1 })] }),
      ],
      { cwd: '/repo', rulesMeta: { ...rulesMeta, 'no-console': { docs: { description: 'No console.' } } } },
    );
    expectValid(log);
    const [shell, consoleRule] = run(log).tool.driver.rules;
    expect(shell?.id).toBe('noctcore-security/no-shell-interpolation');
    expect(shell?.helpUri).toMatch(/^https:\/\//u);
    expect(shell?.properties).toEqual({
      tags: ['security', 'external/cwe/cwe-078', 'external/owasp/a03:2021'],
      'security-severity': '9.8',
    });
    expect(consoleRule).toEqual({ id: 'no-console', shortDescription: { text: 'No console.' } });
    expect(run(log).results.map((result) => [result.ruleIndex, result.level])).toEqual([
      [0, 'error'],
      [0, 'error'],
      [1, 'warning'],
    ]);
    expect(run(log).results[0]?.locations[0]).toEqual({
      physicalLocation: {
        artifactLocation: { uri: 'a.js', uriBaseId: 'SRCROOT', index: 0 },
        region: { startLine: 3, startColumn: 5, endLine: 3, endColumn: 20 },
      },
    });
    expect(run(log).artifacts).toEqual([
      { location: { uri: 'a.js', uriBaseId: 'SRCROOT' } },
      { location: { uri: 'b.js', uriBaseId: 'SRCROOT' } },
    ]);
  });

  it('writes Windows results relative to the working directory', () => {
    const log = buildSarifLog([lintResult('D:\\work\\app\\src\\run.ts', { messages: [message()] })], {
      cwd: 'D:\\work\\app',
      rulesMeta,
    });
    expectValid(log);
    expect(run(log).originalUriBaseIds).toEqual({ SRCROOT: { uri: 'file:///D:/work/app/' } });
    expect(run(log).results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe('src/run.ts');
  });

  it('writes absolute URIs and no base ids when asked', () => {
    const log = buildSarifLog(
      [lintResult('/repo/a.js', { messages: [message()] })],
      { cwd: '/repo', rulesMeta },
      { absoluteUris: true },
    );
    expectValid(log);
    expect(run(log).originalUriBaseIds).toBeUndefined();
    expect(run(log).results[0]?.locations[0]?.physicalLocation.artifactLocation).toEqual({
      uri: 'file:///repo/a.js',
      index: 0,
    });
  });

  it('writes suppressed messages as suppressed results with the directive justification', () => {
    const suppressed = [
      { ...message(), suppressions: [{ kind: 'directive', justification: 'the branch name is validated upstream' }] },
      { ...message({ line: 7 }), suppressions: [{ kind: 'directive', justification: '' }] },
    ] as Linter.SuppressedLintMessage[];
    const log = buildSarifLog([lintResult('/repo/a.js', { suppressedMessages: suppressed })], {
      cwd: '/repo',
      rulesMeta,
    });
    expectValid(log);
    expect(run(log).results.map((result) => result.suppressions)).toEqual([
      [{ kind: 'inSource', justification: 'the branch name is validated upstream' }],
      [{ kind: 'inSource' }],
    ]);
  });

  it('writes fatal parse errors as configuration notifications and marks the run unsuccessful', () => {
    const fatal = message({ ruleId: null, fatal: true, message: 'Parsing error: Unexpected token' });
    const log = buildSarifLog([lintResult('/repo/broken.js', { messages: [fatal] })], { cwd: '/repo', rulesMeta });
    expectValid(log);
    expect(run(log).results).toEqual([]);
    expect(run(log).invocations[0]?.executionSuccessful).toBe(false);
    expect(run(log).invocations[0]?.toolConfigurationNotifications).toEqual([
      {
        level: 'error',
        message: { text: 'Parsing error: Unexpected token' },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: 'broken.js', uriBaseId: 'SRCROOT', index: 0 },
              region: { startLine: 3, startColumn: 5, endLine: 3, endColumn: 20 },
            },
          },
        ],
      },
    ]);
  });
});

describe('formatSarif with ESLint', () => {
  const lint = async (code: string, filePath: string): Promise<[ESLint.LintResult[], ESLint]> => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: [
        {
          plugins: { 'noctcore-security': plugin },
          rules: { 'noctcore-security/no-shell-interpolation': 'error' },
        },
      ],
    });
    return [await eslint.lintText(code, { filePath }), eslint];
  };

  afterEach(() => {
    delete process.env.NOCTCORE_SARIF_ABSOLUTE_URIS;
  });

  it('writes a valid log with relative paths, tags, suppressions and parse errors', async () => {
    const [results, eslint] = await lint(
      [
        'exec(`git checkout ${branch}`);',
        '// eslint-disable-next-line noctcore-security/no-shell-interpolation -- branch is one of ours',
        'exec(`git checkout ${other}`);',
      ].join('\n'),
      'src/run.js',
    );
    const [broken] = await lint('const = ;', 'src/broken.js');
    const all = [...results, ...broken];
    const log = JSON.parse(
      formatSarif(all, { cwd: process.cwd(), rulesMeta: eslint.getRulesMetaForResults(all) }),
    ) as SarifLog;
    expectValid(log);
    expect(run(log).tool.driver.rules[0]?.properties?.tags).toEqual([
      'security',
      'external/cwe/cwe-078',
      'external/owasp/a03:2021',
    ]);
    expect(run(log).results.map((result) => result.locations[0]?.physicalLocation.artifactLocation.uri)).toEqual([
      'src/run.js',
      'src/run.js',
    ]);
    expect(run(log).results[1]?.suppressions).toEqual([
      { kind: 'inSource', justification: 'branch is one of ours' },
    ]);
    expect(run(log).invocations[0]?.executionSuccessful).toBe(false);
  });

  it('writes absolute URIs when NOCTCORE_SARIF_ABSOLUTE_URIS is set, and copes without data', async () => {
    const [results] = await lint('exec(`git checkout ${branch}`);', 'src/run.js');
    process.env.NOCTCORE_SARIF_ABSOLUTE_URIS = '1';
    const log = JSON.parse(formatSarif(results)) as SarifLog;
    expectValid(log);
    expect(run(log).results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toMatch(/^file:\/\/\//u);
    expect(run(log).originalUriBaseIds).toBeUndefined();
  });
});

describe('the built formatter', () => {
  const dist = (file: string): string => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));

  it.each(['sarif.js', 'sarif.cjs'])('dist/%s loads as an ESLint formatter by path', async (file) => {
    expect(existsSync(dist(file)), `run \`bun run build\` before the tests: ${file} is missing`).toBe(true);
    const formatter = await new ESLint().loadFormatter(dist(file));
    const log = JSON.parse(await formatter.format([])) as SarifLog;
    expectValid(log);
    expect(run(log).results).toEqual([]);
  });
});
