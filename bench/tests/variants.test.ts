import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';

import { buildBaseline, compareBaseline, serializeBaseline } from '../src/baseline';
import { loadCorpus, type CorpusCase } from '../src/corpus';
import { promoteVariant } from '../src/promote';
import { loadPlugin, scoreCategories, type LoadedPlugin } from '../src/score';
import { arrowFunctions } from '../src/variants/functions';
import {
  generateCorpusVariants,
  generateVariants,
  MIN_VARIANTS_PER_CASE,
  TRANSFORMS,
} from '../src/variants/generate';
import { callback, promiseThen, viaDestructuring, viaSpread, viaVariable } from '../src/variants/flow';
import { cjsToEsm, importAlias, importNamespace, nodePrefix } from '../src/variants/modules';
import { renameLocals, renameParams } from '../src/variants/names';
import { scoreVariants } from '../src/variants/score';
import { sinkLines } from '../src/variants/sinks';
import { stringConcat, stringJoin, stringTemplate } from '../src/variants/strings';
import type { Transform } from '../src/variants/transform';
import { header, SHELL_CATEGORY, writeCorpus } from './helpers';

const CORPUS = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'corpus');

/** A one-pair demo corpus; returns its cases by kind. */
function demoPair(vuln: string, safe: string, ext = 'js'): { vuln: CorpusCase; safe: CorpusCase } {
  const root = writeCorpus({
    'security/demo/category.json': SHELL_CATEGORY,
    [`security/demo/p.vuln.${ext}.case`]: `${header('p')}\n${vuln}`,
    [`security/demo/p.safe.${ext}.case`]: `${header('p')}\n// ok\n${safe}`,
  });
  const [category] = loadCorpus(root).categories;
  const find = (kind: string): CorpusCase => category?.cases.find((c) => c.kind === kind) as CorpusCase;
  return { vuln: find('vuln'), safe: find('safe') };
}

function rewrite(testCase: CorpusCase, transform: Transform, twins: readonly CorpusCase[] = [testCase]): string | null {
  const result = generateVariants(testCase, twins, [transform]);
  expect(result.problems).toEqual([]);
  return result.variants[0]?.source ?? null;
}

/** The source without the header line, for short expectations. */
function body(source: string | null): string {
  return (source ?? '').split('\n').slice(1).join('\n');
}

describe('the variants of the real corpus', () => {
  const corpus = loadCorpus(CORPUS);
  const { variants, counts } = generateCorpusVariants(corpus.categories);

  it('all parse with the parser the scorer uses', () => {
    const broken = variants.flatMap((v) => {
      try {
        tsParser.parseForESLint(v.source, { filePath: v.lintPath, ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } });
        return [];
      } catch (error) {
        return [`${v.file}: ${(error as Error).message}`];
      }
    });
    expect(broken).toEqual([]);
    // Re-parses every variant of the corpus (thousands); slow CI runners need more than the default 5 s.
  }, 60_000);

  it('keep every label of their case', () => {
    const byFile = new Map(corpus.categories.flatMap((c) => c.cases).map((c) => [c.file, c]));
    const changed = variants.filter((v) => {
      const base = byFile.get(v.baseFile);
      const rules = (c: CorpusCase): string => c.expects.map((e) => e.rule).sort().join(',');
      return base === undefined || rules(base) !== rules(v) || v.source.split('\n')[0] !== base.source.split('\n')[0];
    });
    expect(changed.map((v) => v.file)).toEqual([]);
  });

  it(`gives every security case at least ${MIN_VARIANTS_PER_CASE} variants`, () => {
    const short = [...counts].filter(([, n]) => n < MIN_VARIANTS_PER_CASE);
    expect(short).toEqual([]);
    expect(counts.size).toBe(corpus.categories.flatMap((c) => c.cases).length);
  });

  it('tags every variant with a known transform and its case', () => {
    const names = new Set(TRANSFORMS.map((t) => t.name));
    expect(variants.every((v) => names.has(v.transform) && v.file === `${v.baseFile}~${v.transform}`)).toBe(true);
    expect(new Set(variants.map((v) => v.file)).size).toBe(variants.length);
  });
});

describe('transforms', () => {
  it('renames locals, spelling out shorthand properties and keeping annotations', () => {
    const { vuln } = demoPair(
      "import { exec } from 'node:child_process';\nfunction run(req) {\n  const dir: string = req.query.dir;\n  exec(`ls ${dir}`, { dir }); // expect: security/no-shell-interpolation\n}\n",
      '',
      'ts',
    );
    expect(body(rewrite(vuln, renameLocals))).toBe(
      "import { exec } from 'node:child_process';\nfunction local1(req) {\n  const local2: string = req.query.dir;\n  exec(`ls ${local2}`, { dir: local2 }); // expect: security/no-shell-interpolation\n}\n",
    );
    expect(body(rewrite(vuln, renameParams))).toContain('function run(param1) {\n  const dir: string = param1.query.dir;');
  });

  it('aliases imports and routes them through a namespace, in both module systems', () => {
    const esm = demoPair("import { exec } from 'node:child_process';\nexec(cmd); // expect: security/no-shell-interpolation\n", '');
    expect(body(rewrite(esm.vuln, importAlias))).toBe(
      "import { exec as imported1 } from 'node:child_process';\nimported1(cmd); // expect: security/no-shell-interpolation\n",
    );
    expect(body(rewrite(esm.vuln, importNamespace))).toBe(
      "import * as childProcess from 'node:child_process';\nchildProcess.exec(cmd); // expect: security/no-shell-interpolation\n",
    );
    const cjs = demoPair("const { exec } = require('child_process');\nexec(cmd); // expect: security/no-shell-interpolation\n", '');
    expect(body(rewrite(cjs.vuln, importNamespace))).toBe(
      "const childProcess = require('child_process');\nchildProcess.exec(cmd); // expect: security/no-shell-interpolation\n",
    );
    expect(body(rewrite(cjs.vuln, nodePrefix))).toContain("require('node:child_process')");
  });

  it('converts CommonJS to ESM only when every require has an ESM spelling', () => {
    const plain = demoPair("const { exec } = require('child_process');\nexec(cmd); // expect: security/no-shell-interpolation\nmodule.exports = exec;\n", '');
    expect(body(rewrite(plain.vuln, cjsToEsm))).toBe(
      "import { exec } from 'child_process';\nexec(cmd); // expect: security/no-shell-interpolation\nexport default exec;\n",
    );
    const interop = demoPair("const Store = require('store').default;\nexec(Store); // expect: security/no-shell-interpolation\n", '');
    expect(rewrite(interop.vuln, cjsToEsm)).toBeNull();
  });

  it('moves the sink value through a variable or destructuring on a new line, so the label moves with the sink', () => {
    const { vuln } = demoPair(
      "import { exec } from 'node:child_process';\nfunction run(req) {\n  exec(`ls ${req.query.dir}`); // expect: security/no-shell-interpolation\n}\n",
      '',
    );
    const moved = rewrite(vuln, viaVariable);
    expect(body(moved)).toBe(
      "import { exec } from 'node:child_process';\nfunction run(req) {\n  const relay = req.query.dir;\n  exec(`ls ${relay}`); // expect: security/no-shell-interpolation\n}\n",
    );
    expect(body(rewrite(vuln, viaDestructuring))).toContain('  const { dir } = req.query;\n  exec(`ls ${dir}`);');
    expect(body(rewrite(vuln, viaSpread))).toContain('  const copy = { ...req.query };\n  exec(`ls ${copy.dir}`);');
  });

  it('never moves a value out of an expression-bodied function or before its declaration', () => {
    const { vuln } = demoPair(
      "import { exec } from 'node:child_process';\nitems.forEach((item) => exec(`ls ${item.dir}`)); // expect: security/no-shell-interpolation\n",
      '',
    );
    expect(rewrite(vuln, viaVariable)).toBeNull();
  });

  it('wraps the sink statement in a callback, and in a then callback only inside async functions', () => {
    const { vuln } = demoPair(
      "import { exec } from 'node:child_process';\nfunction run(cmd) {\n  exec(cmd); // expect: security/no-shell-interpolation\n}\n",
      '',
    );
    expect(body(rewrite(vuln, callback))).toContain('  [cmd].forEach((relay) => { exec(relay); }); // expect: security/no-shell-interpolation');
    expect(rewrite(vuln, promiseThen)).toBeNull();
  });

  it('rewrites string building between template, concatenation and join, keeping a template\'s lines', () => {
    const { vuln } = demoPair(
      "import { exec } from 'node:child_process';\nfunction run(a, b) {\n  exec(`ls ${a}\n  --x ${b}`); // expect: security/no-shell-interpolation\n  exec('cat ' + a); // expect: security/no-shell-interpolation\n}\n",
      '',
    );
    expect(body(rewrite(vuln, stringConcat))).toContain("  exec('ls ' + a + '\\n' +\n'  --x ' + b); // expect");
    expect(body(rewrite(vuln, stringTemplate))).toContain('  exec(`cat ${a}`); // expect');
    expect(body(rewrite(vuln, stringJoin))).toContain("  exec(['cat ', a].join('')); // expect");
  });

  it('leaves a `+` that may add numbers alone', () => {
    const { vuln } = demoPair("import { exec } from 'node:child_process';\nexec(a + b + 'x'); // expect: security/no-shell-interpolation\n", '');
    expect(rewrite(vuln, stringTemplate)).toBeNull();
  });

  it('turns arrows into functions only when they do not read this or arguments', () => {
    const { vuln } = demoPair(
      "import { exec } from 'node:child_process';\nconst a = (x) => exec(x); // expect: security/no-shell-interpolation\nconst b = () => this.run();\n",
      '',
    );
    expect(body(rewrite(vuln, arrowFunctions))).toBe(
      "import { exec } from 'node:child_process';\nconst a = function (x) { return exec(x); }; // expect: security/no-shell-interpolation\nconst b = () => this.run();\n",
    );
  });
});

describe('sink lines of a safe twin', () => {
  it('match the labelled line by what it does, preferring the line that reads a value over an early rejection', () => {
    const { vuln, safe } = demoPair(
      "router.get('/x', (req, res) => {\n  res.redirect(req.query.next); // expect: security/no-shell-interpolation\n});\n",
      "router.get('/x', (req, res) => {\n  const target = String(req.query.next);\n  if (!ok(target)) {\n    return res.redirect('/');\n  }\n  res.redirect(target);\n});\n",
    );
    expect(sinkLines(safe, [vuln])).toEqual([8]);
  });
});

describe('variant scores and the ratchet', () => {
  async function scoreWithVariants(files: Record<string, string>) {
    const root = writeCorpus({ 'security/demo/category.json': SHELL_CATEGORY, ...files });
    const corpus = loadCorpus(root);
    const plugins = new Map<string, LoadedPlugin>([['security', await loadPlugin('security')]]);
    const run = scoreCategories(corpus.categories, plugins, root);
    const { variants } = generateCorpusVariants(corpus.categories);
    const variantResults = scoreVariants(corpus.categories, plugins, root, variants);
    return { root, corpus, variants, baseline: buildBaseline(run.results, run.reports, corpus.categories, plugins, variantResults) };
  }

  const PAIR = {
    'security/demo/caught.vuln.js.case': `${header('caught')}\nimport { exec } from 'node:child_process';\nfunction run(req) {\n  exec(\`ls \${req.query.dir}\`); // expect: security/no-shell-interpolation\n}\n`,
    'security/demo/caught.safe.js.case': `${header('caught')}\n// ok\nimport { execFile } from 'node:child_process';\nfunction run(req) {\n  execFile('ls', [req.query.dir]);\n}\n`,
  };

  it('records every variant outcome and a per-transform comparison with the case', async () => {
    const { baseline } = await scoreWithVariants(PAIR);
    const id = 'security/demo/caught.vuln.js.case~import-alias#security/no-shell-interpolation';
    expect(baseline.variants[id]).toBeDefined();
    const transforms = baseline.variantRules['security/no-shell-interpolation']?.transforms ?? {};
    for (const t of Object.values(transforms)) expect(t.holds + t.missed + t.falseAlarms + t.gained).toBe(t.variants);
  });

  it('holds variants to the ratchet: a caught variant that is missed is a regression, a dropped one is removed protection', async () => {
    const { baseline } = await scoreWithVariants(PAIR);
    const committed = JSON.parse(serializeBaseline(baseline)) as { variants: Record<string, string> };
    const [caught] = Object.entries(committed.variants).filter(([, o]) => o === 'TP');
    expect(caught).toBeDefined();
    const [id = ''] = caught ?? [];
    committed.variants[id] = 'FN';
    expect(compareBaseline(committed as never, baseline).improvements.map((c) => c.id)).toEqual([id]);
    const current = JSON.parse(serializeBaseline(baseline)) as { variants: Record<string, string> };
    const recorded = JSON.parse(serializeBaseline(baseline)) as never;
    current.variants[id] = 'FN';
    expect(compareBaseline(recorded, current as never).regressions).toEqual([
      { id, rule: 'security/no-shell-interpolation', from: 'TP', to: 'FN' },
    ]);
    delete current.variants[id];
    expect(compareBaseline(recorded, current as never).removedProtection.map((c) => c.id)).toEqual([id]);
  });

  it('promotes a variant to a committed pair that loads as a valid corpus', async () => {
    const { root, corpus, variants } = await scoreWithVariants(PAIR);
    const promotion = promoteVariant(root, corpus.categories, variants, 'security/demo/caught.vuln.js.case~import-alias');
    expect(promotion.written).toEqual([
      'security/demo/caught-import-alias.safe.js.case',
      'security/demo/caught-import-alias.vuln.js.case',
    ]);
    const reloaded = loadCorpus(root);
    const promoted = reloaded.categories[0]?.cases.find((c) => c.file === 'security/demo/caught-import-alias.vuln.js.case');
    expect(promoted?.meta.pair).toBe('caught-import-alias');
    expect(promoted?.expects).toHaveLength(1);
    expect(readFileSync(join(root, 'security/demo/caught-import-alias.vuln.js.case'), 'utf8')).toContain('exec as imported1');
    expect(() => promoteVariant(root, corpus.categories, variants, 'security/demo/caught.vuln.js.case~import-alias')).toThrow(/already promoted/u);
  });
});

describe('the README', () => {
  it('documents every transform', () => {
    const readme = readFileSync(join(CORPUS, '..', 'README.md'), 'utf8');
    expect(TRANSFORMS.map((t) => t.name).filter((name) => !readme.includes(`| \`${name}\` |`))).toEqual([]);
  });
});
