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
 *
 * Three more attributes tie a doc to what the rule prints and reads:
 *
 * - `message=crossFeatureImport` (or `message=a,b`) on a bad example names the
 *   message ids it draws: every report it draws must be one of them, and each
 *   one must be drawn, as a report or as one of a report's suggestions.
 * - `fixture=component-folder/bad` lints the example as if its file sat in
 *   `tests/fixtures/<fixture>/` of the package, so a rule that reads sibling
 *   files from disk runs against a real folder. The pairing of good and bad
 *   examples still compares the `filename` as written: a different fixture is
 *   the fix on disk, not a move.
 * - A ` ```text report ` fence right after a bad example holds what ESLint
 *   prints for it: its reports' messages, in order, a blank line between two.
 *
 * A doc whose `What you will see` section carries the generated message list
 * (`<!-- begin generated messages -->`) is on the rule page template: every bad
 * example there must say `message=`, and between them they must draw every
 * message the list names, each as the kind (report or suggestion) it is listed as.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';

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
  /** The message ids a bad example claims to draw (`message=`). */
  readonly messageIds: readonly string[];
  /** The fixture folder under the package's `tests/fixtures/` the example lints in. */
  readonly fixture: string | undefined;
  /** The text of a `text report` fence right after a bad example: what ESLint prints. */
  readonly report: string | undefined;
}

/** A lint message reduced to what a doc check reports. */
export interface DocMessage {
  readonly ruleId: string | null;
  readonly message: string;
  readonly line: number;
  readonly fatal: boolean;
  readonly messageId: string | undefined;
  /** The message ids of the report's suggestions. */
  readonly suggestions: readonly string[];
}

/** Anything with a `rules` map: every `@noctcore` plugin's default export. */
export interface DocPlugin {
  readonly rules: Readonly<Record<string, unknown>>;
}

const EXAMPLE_LANGS = new Set(['ts', 'tsx', 'js', 'jsx']);
const LABELS = new Set<string>(['bad', 'good', 'prose']);
const FLAGS = new Set(['relocation', 'reconfigured']);
const KEYS = new Set(['filename', 'options', 'reason', 'reports', 'message', 'fixture']);

/** The markers around the generated message list of a rule page (`site/scripts/readmes.ts` writes it). */
export const MESSAGES_BEGIN = '<!-- begin generated messages -->';
export const MESSAGES_END = '<!-- end generated messages -->';
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
  // The block the previous fence produced, so a `report` fence can attach to it.
  let previous: DocBlock | undefined;
  for (const fence of fences(markdown)) {
    const [lang = '', ...rest] = tokenize(fence.info);
    const at = `line ${fence.line}`;
    const label = rest[0];
    if (label === 'report') {
      if (lang !== 'text' || rest.length > 1) problems.push(`${at}: a report fence is \`text report\`, with nothing else`);
      if (previous?.kind !== 'bad' || previous.report !== undefined) {
        problems.push(`${at}: a report fence must come right after the bad example it reports`);
      } else {
        const index = blocks.indexOf(previous);
        previous = { ...previous, report: fence.code };
        blocks[index] = previous;
      }
      continue;
    }
    previous = undefined;
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
    let messageIds: readonly string[] = [];
    let fixture: string | undefined;
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
        else if (key === 'message') messageIds = value.split(',').filter((id) => id !== '');
        else if (key === 'fixture') fixture = value;
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
    if (kind !== 'bad' && messageIds.length > 0) {
      problems.push(`${at}: message= only belongs on a bad example`);
    }
    if (kind === 'prose' && fixture !== undefined) {
      problems.push(`${at}: fixture= only belongs on a bad or good example`);
    }
    if (kind !== 'good' && flags.size > 0) {
      problems.push(`${at}: ${[...flags].join(', ')} only belongs on a good example`);
    }
    // Running with options the doc failed to state would test something else.
    if (!runnable) continue;
    const block: DocBlock = {
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
      messageIds,
      fixture,
      report: undefined,
    };
    blocks.push(block);
    previous = block;
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

const linters = new Map<string, Linter>();

/** One linter per working directory: an example in a fixture lints with the fixture folder as its cwd. */
function linterFor(cwd: string | undefined): Linter {
  const key = cwd ?? '';
  let linter = linters.get(key);
  if (linter === undefined) {
    linter = new eslint.Linter(cwd === undefined ? { configType: 'flat' } : { configType: 'flat', cwd });
    linters.set(key, linter);
  }
  return linter;
}

/** Where a doc's `fixture=` folders live, and how a fixture example is linted. */
export interface DocContext {
  /** The package's `tests/fixtures` directory. */
  readonly fixturesDir?: string;
}

/** The fixtures directory of the package a rule doc (`<pkg>/docs/rules/<rule>.md`) belongs to. */
export function fixturesDirOf(docPath: string): string {
  return join(dirname(docPath), '..', '..', 'tests', 'fixtures');
}

/** Lints one example with only the documented rule enabled. */
export function lintDocBlock(plugin: DocPlugin, ruleName: string, block: DocBlock, context: DocContext = {}): DocMessage[] {
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
  let cwd: string | undefined;
  let filename = block.filename;
  if (block.fixture !== undefined) {
    if (context.fixturesDir === undefined) throw new Error('fixture= needs the package fixtures directory');
    cwd = join(context.fixturesDir, block.fixture);
    if (!existsSync(cwd)) throw new Error(`fixture folder ${cwd} does not exist`);
    filename = join(cwd, block.filename);
  }
  return linterFor(cwd)
    .verify(block.code, [config], { filename })
    .map((m) => ({
      ruleId: m.ruleId,
      message: m.message,
      line: m.line,
      fatal: m.fatal === true,
      messageId: m.messageId,
      suggestions: (m.suggestions ?? []).flatMap((s) => (s.messageId === undefined ? [] : [s.messageId])),
    }));
}

function describeMessages(messages: readonly DocMessage[]): string {
  return messages.map((m) => `  ${m.line}: ${m.ruleId ?? 'fatal'}: ${m.message}`).join('\n');
}

/** Why an executed example disagrees with its label, or `undefined` when it agrees. */
export function checkDocBlock(
  plugin: DocPlugin,
  ruleName: string,
  block: DocBlock,
  context: DocContext = {},
): string | undefined {
  const at = `line ${block.line} (${block.kind}, ${block.filename})`;
  let messages: DocMessage[];
  try {
    messages = lintDocBlock(plugin, ruleName, block, context);
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
    if (block.messageIds.length > 0) {
      const claimed = new Set(block.messageIds);
      const stray = own.filter((m) => !claimed.has(m.messageId ?? ''));
      if (stray.length > 0) {
        return `${at}: bad example draws message(s) its message= does not name (${[...new Set(stray.map((m) => m.messageId))].join(', ')}):\n${describeMessages(stray)}`;
      }
      const drawn = new Set(own.flatMap((m) => [m.messageId ?? '', ...m.suggestions]));
      const missing = block.messageIds.filter((id) => !drawn.has(id));
      if (missing.length > 0) return `${at}: bad example names message(s) it never draws: ${missing.join(', ')}`;
    }
    if (block.report !== undefined) {
      const printed = own.map((m) => m.message).join('\n\n');
      if (printed !== block.report) {
        return `${at}: the report fence after this example does not match what ESLint prints:\n--- printed\n${printed}\n--- report fence\n${block.report}`;
      }
    }
  }
  return undefined;
}

/** One entry of a rule page's generated message list. */
export interface ListedMessage {
  readonly id: string;
  readonly kind: 'report' | 'suggestion';
}

/**
 * The generated message list of a rule page, or `undefined` for a doc not on
 * the template. Lines look like ``- `crossFeatureImport`: text`` and
 * ``- `renameExport` (suggestion): text``.
 */
export function listedMessages(markdown: string): ListedMessage[] | undefined {
  const start = markdown.indexOf(MESSAGES_BEGIN);
  const end = markdown.indexOf(MESSAGES_END);
  if (start === -1 || end < start) return undefined;
  return markdown
    .slice(start + MESSAGES_BEGIN.length, end)
    .split('\n')
    .flatMap((line) => {
      const match = /^- `([^`]+)`( \(suggestion\))?: /.exec(line);
      return match ? [{ id: match[1]!, kind: match[2] ? ('suggestion' as const) : ('report' as const) }] : [];
    });
}

/**
 * On a rule page, every bad example names its messages and between them they
 * draw every listed message, each as the kind it is listed as.
 */
export function checkMessageCoverage(
  plugin: DocPlugin,
  ruleName: string,
  markdown: string,
  blocks: readonly DocBlock[],
  context: DocContext = {},
): string[] {
  const listed = listedMessages(markdown);
  if (listed === undefined) return [];
  const problems: string[] = [];
  const bad = blocks.filter((b) => b.kind === 'bad');
  for (const block of bad) {
    if (block.messageIds.length === 0) problems.push(`line ${block.line}: a bad example on a rule page names its message ids with message=`);
  }
  const reported = new Set<string>();
  const suggested = new Set<string>();
  for (const block of bad) {
    let messages: DocMessage[];
    try {
      messages = lintDocBlock(plugin, ruleName, block, context);
    } catch {
      continue; // checkDocBlock reports the failure.
    }
    for (const m of messages.filter((msg) => msg.ruleId === `${NAMESPACE}/${ruleName}`)) {
      if (m.messageId !== undefined) reported.add(m.messageId);
      for (const s of m.suggestions) suggested.add(s);
    }
  }
  for (const { id, kind } of listed) {
    const seen = kind === 'report' ? reported.has(id) : suggested.has(id);
    if (!seen) {
      problems.push(`message \`${id}\` is listed as a ${kind}, but no bad example draws it as one`);
    }
  }
  return problems;
}

/** Every problem in one rule doc: its structure, then each executed example. */
export function collectDocProblems(
  plugin: DocPlugin,
  ruleName: string,
  markdown: string,
  context: DocContext = {},
): string[] {
  const { blocks, problems } = parseDocExamples(markdown);
  const found = [...problems, ...checkDocStructure(blocks), ...checkMessageCoverage(plugin, ruleName, markdown, blocks, context)];
  for (const block of blocks) {
    if (block.kind === 'prose') continue;
    const problem = checkDocBlock(plugin, ruleName, block, context);
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
  const markdown = readFileSync(docPath, 'utf8');
  const { blocks, problems } = parseDocExamples(markdown);
  const context: DocContext = { fixturesDir: fixturesDirOf(docPath) };
  describe(`${ruleName} doc examples`, () => {
    it('labels every example and pairs each good one with a bad one', () => {
      expect([...problems, ...checkDocStructure(blocks)].join('\n')).toBe('');
    });
    if (listedMessages(markdown) !== undefined) {
      it('draws every message the page lists', () => {
        expect(checkMessageCoverage(plugin, ruleName, markdown, blocks, context).join('\n')).toBe('');
      });
    }
    for (const block of blocks) {
      if (block.kind === 'prose') continue;
      it(`${block.kind} example at line ${block.line}`, () => {
        expect(checkDocBlock(plugin, ruleName, block, context)).toBeUndefined();
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
