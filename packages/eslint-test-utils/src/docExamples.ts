/**
 * Executes the code examples in a rule's markdown doc, so a doc that drifts
 * from its rule fails a test instead of misleading a reader.
 *
 * A fence opts in with a label after its language:
 *
 *     ```ts bad filename=src/api/client.test.ts options={"checkLoops":true}
 *     ```ts good
 *     ```ts prose reason="the rule reads sibling files from disk"
 *
 * `bad` must draw at least one report from the documented rule, or exactly
 * `reports=N` when a block shows several violations. `good` must
 * draw no message at all, which also rejects a parse error. `prose` is not run
 * and must say why; it may be in any language, such as a `text` file tree.
 * Every `ts` / `tsx` fence needs a label, so an example
 * cannot sit in a doc unexamined. Other fences (a `js` config snippet, a
 * `jsonc` default) are left alone.
 *
 * A `good` example must be the fix for a `bad` one, not a way around the rule:
 * it runs under the filename and options of some `bad` block unless it says
 * otherwise with `relocation` (a different file) or `reconfigured` (different
 * options). Moving the code is the documented fix for some rules and an
 * evasion for the rest, so the doc has to claim it out loud.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

import * as parser from '@typescript-eslint/parser';
import type { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * The ESLint `RuleTester` runs on. A static `import` of `eslint` here goes
 * through Vite's resolver, which the `eslint9` resolve hook never sees, so the
 * ESLint 9 run would lint docs on ESLint 10. `require` from the rule tester's
 * own location resolves through Node, hook included, to the same copy.
 */
const eslint = ((): typeof import('eslint') => {
  const fromHere = createRequire(import.meta.url);
  return createRequire(fromHere.resolve('@typescript-eslint/rule-tester'))('eslint') as typeof import('eslint');
})();

/** The version of ESLint the doc examples are linted with. */
export const docLinterVersion: string = eslint.Linter.version;

/** The labels a fence can carry. */
export type DocBlockKind = 'bad' | 'good' | 'prose';

/** One labelled fence from a rule doc. */
export interface DocBlock {
  readonly kind: DocBlockKind;
  /** The fence language: `ts`, `tsx`, `js` or `jsx`. */
  readonly lang: string;
  readonly code: string;
  /** 1-based line of the opening fence in the doc. */
  readonly line: number;
  /** The file the example is linted as. Defaults to `src/example.<lang>`. */
  readonly filename: string;
  /** The rule's options array. `options=` names the first (usually only) option. */
  readonly options: readonly unknown[];
  readonly relocation: boolean;
  readonly reconfigured: boolean;
  readonly reason: string | undefined;
  /** How many reports a bad example must draw, when it pins the count. */
  readonly reports: number | undefined;
}

/** A lint message reduced to what a doc check reports. */
export interface DocMessage {
  readonly ruleId: string | null;
  readonly message: string;
  readonly line: number;
  readonly fatal: boolean;
}

/** Anything with a `rules` map: every `@noctcore` plugin's default export. */
export interface DocPlugin {
  readonly rules: Readonly<Record<string, unknown>>;
}

const EXAMPLE_LANGS = new Set(['ts', 'tsx', 'js', 'jsx']);
const LABELS = new Set<string>(['bad', 'good', 'prose']);
const FLAGS = new Set(['relocation', 'reconfigured']);
const KEYS = new Set(['filename', 'options', 'reason', 'reports']);
const NAMESPACE = 'doc';

interface ParsedDoc {
  readonly blocks: readonly DocBlock[];
  readonly problems: readonly string[];
}

interface Fence {
  readonly info: string;
  readonly code: string;
  readonly line: number;
}

function* fences(markdown: string): Generator<Fence> {
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i] ?? '');
    if (open === null) continue;
    const [, indent = '', marker = '', info = ''] = open;
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !(lines[j] ?? '').trim().startsWith(marker)) {
      body.push((lines[j] ?? '').startsWith(indent) ? (lines[j] ?? '').slice(indent.length) : (lines[j] ?? ''));
      j += 1;
    }
    yield { info: info.trim(), code: body.join('\n'), line: i + 1 };
    i = j;
  }
}

/** Splits an info string into words, keeping a JSON value after `key=` whole. */
function tokenize(info: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < info.length) {
    if (/\s/.test(info[i] ?? '')) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < info.length && !/[\s=]/.test(info[i] ?? '')) i += 1;
    if (info[i] === '=') {
      i += 1;
      i = scanValue(info, i);
    }
    tokens.push(info.slice(start, i));
  }
  return tokens;
}

function scanValue(info: string, from: number): number {
  const open = info[from];
  if (open !== '{' && open !== '[' && open !== '"') {
    let i = from;
    while (i < info.length && !/\s/.test(info[i] ?? '')) i += 1;
    return i;
  }
  let depth = 0;
  let inString = false;
  for (let i = from; i < info.length; i += 1) {
    const ch = info[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') {
        inString = false;
        if (depth === 0) return i + 1;
      }
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return info.length;
}

function parseJson(raw: string, what: string, at: string, problems: string[]): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    problems.push(`${at}: ${what} is not valid JSON (${raw}): ${String(error)}`);
    return undefined;
  }
}

/** Reads every labelled example out of a rule doc. */
export function parseDocExamples(markdown: string): ParsedDoc {
  const blocks: DocBlock[] = [];
  const problems: string[] = [];
  for (const fence of fences(markdown)) {
    const [lang = '', ...rest] = tokenize(fence.info);
    const at = `line ${fence.line}`;
    const label = rest[0];
    if (label === undefined || !LABELS.has(label)) {
      if (lang === 'ts' || lang === 'tsx') {
        problems.push(`${at}: \`${lang}\` fence has no bad / good / prose label`);
      }
      continue;
    }
    if (label !== 'prose' && !EXAMPLE_LANGS.has(lang)) {
      problems.push(`${at}: a ${label} example must be ts, tsx, js or jsx, not \`${lang}\``);
      continue;
    }
    let filename = `src/example.${lang}`;
    let options: readonly unknown[] = [];
    let reason: string | undefined;
    let reports: number | undefined;
    let runnable = true;
    const flags = new Set<string>();
    for (const token of rest.slice(1)) {
      const eq = token.indexOf('=');
      const key = eq === -1 ? token : token.slice(0, eq);
      const value = eq === -1 ? '' : token.slice(eq + 1);
      if (eq === -1 && FLAGS.has(key)) flags.add(key);
      else if (eq !== -1 && KEYS.has(key)) {
        if (key === 'filename') filename = value;
        else if (key === 'options') {
          const parsed = parseJson(value, 'options', at, problems);
          runnable &&= parsed !== undefined;
          options = [parsed];
        }
        else if (key === 'reports') {
          reports = Number(value);
          if (!Number.isInteger(reports) || reports < 1) {
            problems.push(`${at}: reports= must be a positive integer, not \`${value}\``);
          }
        } else {
          const parsed = value.startsWith('"') ? parseJson(value, 'reason', at, problems) : value;
          reason = typeof parsed === 'string' ? parsed.trim() : undefined;
        }
      } else problems.push(`${at}: unknown fence attribute \`${token}\``);
    }
    const kind = label as DocBlockKind;
    if (kind === 'prose' && (reason === undefined || reason === '')) {
      problems.push(`${at}: a prose example must state why it is not executed (reason="...")`);
    }
    if (kind !== 'prose' && reason !== undefined) {
      problems.push(`${at}: reason= only belongs on a prose example`);
    }
    if (kind !== 'bad' && reports !== undefined) {
      problems.push(`${at}: reports= only belongs on a bad example`);
    }
    if (kind !== 'good' && flags.size > 0) {
      problems.push(`${at}: ${[...flags].join(', ')} only belongs on a good example`);
    }
    // Running with options the doc failed to state would test something else.
    if (!runnable) continue;
    blocks.push({
      kind,
      lang,
      code: fence.code,
      line: fence.line,
      filename,
      options,
      relocation: flags.has('relocation'),
      reconfigured: flags.has('reconfigured'),
      reason,
      reports,
    });
  }
  return { blocks, problems };
}

/** Checks the shape of a doc's examples: coverage and the fix-not-evasion rule. */
export function checkDocStructure(blocks: readonly DocBlock[]): string[] {
  const problems: string[] = [];
  const bad = blocks.filter((b) => b.kind === 'bad');
  const good = blocks.filter((b) => b.kind === 'good');
  const prose = blocks.filter((b) => b.kind === 'prose' && b.reason !== undefined && b.reason !== '');
  if (prose.length === 0 && (bad.length === 0 || good.length === 0)) {
    problems.push(
      `needs at least one bad and one good example (has ${bad.length} bad, ${good.length} good), or a prose example with a reason`,
    );
  }
  const badFiles = new Set(bad.map((b) => b.filename));
  const badOptions = new Set(bad.map((b) => JSON.stringify(b.options)));
  for (const block of good) {
    const at = `line ${block.line}`;
    const movesFile = bad.length > 0 && !badFiles.has(block.filename);
    const changesOptions = bad.length > 0 && !badOptions.has(JSON.stringify(block.options));
    if (movesFile && !block.relocation) {
      problems.push(
        `${at}: good example runs as ${block.filename}, which no bad example uses; a different file only counts as the fix when marked \`relocation\``,
      );
    }
    if (!movesFile && block.relocation) {
      problems.push(`${at}: marked \`relocation\` but runs as the same file as a bad example`);
    }
    if (changesOptions && !block.reconfigured) {
      problems.push(
        `${at}: good example uses options no bad example uses; different options only count as the fix when marked \`reconfigured\``,
      );
    }
    if (!changesOptions && block.reconfigured) {
      problems.push(`${at}: marked \`reconfigured\` but uses the options of a bad example`);
    }
  }
  return problems;
}

const linter = new eslint.Linter({ configType: 'flat' });

/** Lints one example with only the documented rule enabled. */
export function lintDocBlock(plugin: DocPlugin, ruleName: string, block: DocBlock): DocMessage[] {
  const jsx = block.lang === 'tsx' || block.lang === 'jsx';
  const config = {
    // A bare `**/*` is a universal pattern and matches nothing on its own.
    files: ['**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}'],
    plugins: { [NAMESPACE]: plugin },
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx } },
    },
    rules: { [`${NAMESPACE}/${ruleName}`]: ['error', ...block.options] },
  } as Linter.Config;
  return linter.verify(block.code, [config], { filename: block.filename }).map((m) => ({
    ruleId: m.ruleId,
    message: m.message,
    line: m.line,
    fatal: m.fatal === true,
  }));
}

function describeMessages(messages: readonly DocMessage[]): string {
  return messages.map((m) => `  ${m.line}: ${m.ruleId ?? 'fatal'}: ${m.message}`).join('\n');
}

/** Why an executed example disagrees with its label, or `undefined` when it agrees. */
export function checkDocBlock(plugin: DocPlugin, ruleName: string, block: DocBlock): string | undefined {
  const at = `line ${block.line} (${block.kind}, ${block.filename})`;
  let messages: DocMessage[];
  try {
    messages = lintDocBlock(plugin, ruleName, block);
  } catch (error) {
    // ESLint throws on a config it rejects, such as options the rule's schema disallows.
    return `${at}: ESLint rejected the example: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (block.kind === 'good' && messages.length > 0) {
    return `${at}: good example drew ${messages.length} message(s):\n${describeMessages(messages)}`;
  }
  if (block.kind === 'bad') {
    const fatal = messages.filter((m) => m.fatal);
    if (fatal.length > 0) return `${at}: bad example does not parse:\n${describeMessages(fatal)}`;
    const own = messages.filter((m) => m.ruleId === `${NAMESPACE}/${ruleName}`);
    if (own.length === 0) return `${at}: bad example drew no report from ${ruleName}`;
    if (block.reports !== undefined && own.length !== block.reports) {
      return `${at}: bad example claims ${block.reports} report(s) but drew ${own.length}:\n${describeMessages(own)}`;
    }
  }
  return undefined;
}

/** Every problem in one rule doc: its structure, then each executed example. */
export function collectDocProblems(plugin: DocPlugin, ruleName: string, markdown: string): string[] {
  const { blocks, problems } = parseDocExamples(markdown);
  const found = [...problems, ...checkDocStructure(blocks)];
  for (const block of blocks) {
    if (block.kind === 'prose') continue;
    const problem = checkDocBlock(plugin, ruleName, block);
    if (problem !== undefined) found.push(problem);
  }
  return found;
}

export interface RunDocExamplesOptions {
  readonly plugin: DocPlugin;
  readonly ruleName: string;
  readonly docPath: string;
}

/** Registers a Vitest suite that runs every example in one rule doc. */
export function runDocExamples({ plugin, ruleName, docPath }: RunDocExamplesOptions): void {
  // A missing doc is one failing test, not a collection error that hides every other result.
  if (!existsSync(docPath)) {
    describe(`${ruleName} doc examples`, () => {
      it('has a doc', () => {
        expect(existsSync(docPath), `no doc at ${docPath}`).toBe(true);
      });
    });
    return;
  }
  const { blocks, problems } = parseDocExamples(readFileSync(docPath, 'utf8'));
  describe(`${ruleName} doc examples`, () => {
    it('labels every example and pairs each good one with a bad one', () => {
      expect([...problems, ...checkDocStructure(blocks)].join('\n')).toBe('');
    });
    for (const block of blocks) {
      if (block.kind === 'prose') continue;
      it(`${block.kind} example at line ${block.line}`, () => {
        expect(checkDocBlock(plugin, ruleName, block)).toBeUndefined();
      });
    }
  });
}

/** Rule names with no doc, and docs with no rule. */
export function compareRulesToDocs(
  plugin: DocPlugin,
  docsDir: string,
): { readonly undocumented: string[]; readonly orphaned: string[] } {
  const rules = new Set(Object.keys(plugin.rules));
  const docs = new Set(
    readdirSync(docsDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => basename(file, '.md')),
  );
  return {
    undocumented: [...rules].filter((rule) => !docs.has(rule)).sort(),
    orphaned: [...docs].filter((doc) => !rules.has(doc)).sort(),
  };
}

export interface RunPluginDocsOptions {
  readonly plugin: DocPlugin;
  /** The plugin's `docs/rules` directory. */
  readonly docsDir: string;
}

/**
 * Registers the doc suite for a whole plugin: every exported rule has a doc,
 * every doc has a rule, and every doc's examples run as labelled.
 */
export function runPluginDocs({ plugin, docsDir }: RunPluginDocsOptions): void {
  it('documents every rule, and every doc names a rule', () => {
    expect(compareRulesToDocs(plugin, docsDir)).toEqual({ undocumented: [], orphaned: [] });
  });
  for (const ruleName of Object.keys(plugin.rules).sort()) {
    runDocExamples({ plugin, ruleName, docPath: join(docsDir, `${ruleName}.md`) });
  }
}
