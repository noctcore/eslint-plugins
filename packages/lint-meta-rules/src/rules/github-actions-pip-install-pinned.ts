import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_WORKFLOW_GLOBS, globFiles, stripYamlComment, unquote } from './shared';

/** Options for {@link createGithubActionsPipInstallPinnedRule}. */
export interface GithubActionsPipInstallPinnedOptions {
  /** Globs of the workflow files to scan. Default `.github/workflows/*.y(a)ml`. */
  readonly workflowGlobs?: readonly string[];
  /**
   * The command prefixes that start an install, each written without the trailing `install`
   * word (a trailing ` install` is tolerated). Passing the option replaces the default list
   * (`pip`, `pip3`, `python -m pip`, `python3 -m pip`, `uv pip`, `pipx`).
   */
  readonly installers?: readonly string[];
  /** Whether a violation fails CI. Default `false`: the rule reports without failing until you opt in. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'github-actions-pip-install-pinned';

const DEFAULT_INSTALLERS: readonly string[] = [
  'pip',
  'pip3',
  'python -m pip',
  'python3 -m pip',
  'uv pip',
  'pipx',
];

const VALUE_FLAGS = new Set<string>([
  '-r',
  '--requirement',
  '-c',
  '--constraint',
  '-e',
  '--editable',
  '-i',
  '--index-url',
  '--extra-index-url',
  '-f',
  '--find-links',
  '-t',
  '--target',
  '--python',
  '-p',
  '--prefix',
  '--root',
  '--src',
  '--platform',
  '--python-version',
  '--implementation',
  '--abi',
  '--no-binary',
  '--only-binary',
  '--upgrade-strategy',
  '--progress-bar',
  '--cache-dir',
  '--log',
  '--proxy',
  '--retries',
  '--timeout',
  '--trusted-host',
  '--cert',
  '--client-cert',
  '--exists-action',
  '-C',
  '--config-settings',
  '--report',
  '--pip-args',
  '--suffix',
  '--index-strategy',
  '--resolution',
  '--prerelease',
  '--override',
  '--extra',
]);

const RUN_KEY = /^(\s*)(-\s+)?run:(?:\s+(.*))?$/u;
const BLOCK_INDICATOR = /^[|>][-+0-9]*\s*(?:#.*)?$/u;
const MAPPING_LINE = /^\s*[\w-]+:(?:\s|$)/u;
const EXPRESSION = /\$\{\{.*?\}\}/gu;
const SEPARATORS = /&&|\|\||;|\||(?<![<>])&(?!>)/gu;
const SEPARATOR_TOKENS = new Set<string>(['&&', '||', ';', '|', '&']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/u;
const REDIRECTION = /^(?:\d*[<>]|&>)/u;
const LOCAL_FILE = /\.(?:txt|whl|tar\.gz|zip)$/u;
const REQUIREMENT =
  /^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?(?:(===|==|~=|!=|<=|>=|<|>)(.*))?$/u;

interface ScriptLine {
  readonly line: number;
  readonly text: string;
}

interface Token {
  readonly line: number;
  readonly text: string;
}

interface Pin {
  readonly name: string;
  readonly operator: string | null;
}

function indentOf(line: string): number {
  return /^\s*/u.exec(line)?.[0].length ?? 0;
}

/*
 * Every `run:` body of a workflow as its physical lines with 1-indexed line numbers. A `#` after
 * whitespace starts a shell comment, so it is stripped from every line. A `run:` holding a mapping
 * (`defaults.run`) has no script and yields nothing, and `run:` text inside a body is script.
 */
function runScripts(lines: readonly string[]): ScriptLine[][] {
  const scripts: ScriptLine[][] = [];
  let skipThrough = -1;

  lines.forEach((line, index) => {
    const match = index > skipThrough ? RUN_KEY.exec(line) : null;
    if (match === null) return;

    const keyColumn = (match[1]?.length ?? 0) + (match[2]?.length ?? 0);
    const inline = match[3] ?? '';
    const block = BLOCK_INDICATOR.test(inline.trim());

    const collected: ScriptLine[] = block
      ? []
      : [{ line: index + 1, text: unquote(stripYamlComment(inline)) }];
    for (let j = index + 1; j < lines.length; j += 1) {
      const next = lines[j] ?? '';
      if (next.trim() !== '' && indentOf(next) <= keyColumn) break;
      collected.push({ line: j + 1, text: stripYamlComment(next) });
    }

    skipThrough = (collected[collected.length - 1]?.line ?? index + 1) - 1;

    const first = collected.find((entry) => entry.text.trim() !== '');
    if (inline.trim() === '' && first !== undefined && MAPPING_LINE.test(first.text)) return;
    scripts.push(collected);
  });

  return scripts;
}

/*
 * The logical commands of one body. A `${{ }}` expression becomes one word first, so an expression
 * holding spaces or `||` stays whole. A line ending in `\` continues into the next, and every token
 * keeps its own physical line.
 */
function scriptTokens(script: readonly ScriptLine[]): Token[][] {
  const commands: Token[][] = [];
  let current: Token[] = [];
  const flush = (): void => {
    if (current.length > 0) commands.push(current);
    current = [];
  };

  for (const entry of script) {
    const withoutExpressions = entry.text.replace(EXPRESSION, () => '$EXPR');
    const continues = /\\\s*$/u.test(withoutExpressions);
    const text = continues ? withoutExpressions.replace(/\\\s*$/u, '') : withoutExpressions;

    const words = text
      .replace(SEPARATORS, ' $& ')
      .split(/\s+/u)
      .filter((word) => word !== '');
    for (const word of words) {
      if (SEPARATOR_TOKENS.has(word)) flush();
      else current.push({ line: entry.line, text: word });
    }
    if (!continues) flush();
  }
  flush();

  return commands;
}

function stripQuotes(value: string): string {
  return value.replace(/^(['"])(.*)\1$/u, '$2');
}

function normalizeInstaller(installer: string): readonly string[] {
  return installer
    .trim()
    .replace(/\s+install$/u, '')
    .split(/\s+/u)
    .filter((word) => word !== '');
}

/*
 * The installer and the package tokens of one command that starts with an install, or null. Whole
 * words at the command start, so `uv pip install` never matches the `pip` installer.
 */
function installTargets(
  command: readonly Token[],
  installers: readonly (readonly string[])[],
): { installer: string; packages: Token[] } | null {
  let start = 0;
  while (ASSIGNMENT.test(command[start]?.text ?? '')) start += 1;
  if (command[start]?.text === 'sudo') start += 1;

  for (const words of installers) {
    if (words.length === 0) continue;
    const prefix = command.slice(start, start + words.length).map((token) => token.text);
    const hasPrefix = prefix.length === words.length && words.every((w, i) => w === prefix[i]);
    if (!hasPrefix || command[start + words.length]?.text !== 'install') continue;

    const packages: Token[] = [];
    let skipNext = false;
    for (const token of command.slice(start + words.length + 1)) {
      if (REDIRECTION.test(token.text)) break;
      if (skipNext) {
        skipNext = false;
        continue;
      }
      const bare = stripQuotes(token.text);
      if (bare === '--') continue;
      if (bare.startsWith('-')) {
        skipNext = VALUE_FLAGS.has(bare);
        continue;
      }
      if (bare === '.' || bare.includes('/') || LOCAL_FILE.test(bare)) continue;
      packages.push(token);
    }
    return { installer: words.join(' '), packages };
  }

  return null;
}

/** The name and pin operator of a package token, or null when it cannot be judged from the text. */
function pinOf(token: string): Pin | null {
  const match = REQUIREMENT.exec(stripQuotes(token));
  if (match === null) return null;
  return { name: match[1] ?? '', operator: match[3] ?? null };
}

function unpinnedMessage(
  line: number,
  installer: string,
  token: string,
  pin: Pin,
): string {
  if (pin.operator === '>=' || pin.operator === '~=') {
    return `line ${line}: \`${installer} install\` installs "${stripQuotes(token)}", a \`${pin.operator}\` range that a new release still satisfies. Pin an exact version with \`==\` instead.`;
  }
  return `line ${line}: \`${installer} install\` installs "${pin.name}" with no version pin. Pin an exact version with \`==\` (for example \`${pin.name}==1.2.3\`) so a new release cannot change what CI runs without a reviewed diff.`;
}

/**
 * Check one workflow's text. An unpinned `pip install` resolves to whatever release is newest on
 * the day CI runs, so a green workflow can turn red (or run different code) with no commit. An
 * exact `==` pin makes the move a reviewed diff.
 */
export function checkWorkflowPipInstallsPinned(
  file: string,
  text: string,
  installers: readonly string[] = DEFAULT_INSTALLERS,
): IViolation[] {
  const normalized = installers.map(normalizeInstaller);
  const violations: IViolation[] = [];

  for (const script of runScripts(text.split('\n'))) {
    for (const command of scriptTokens(script)) {
      const target = installTargets(command, normalized);
      if (target === null) continue;

      for (const token of target.packages) {
        const pin = pinOf(token.text);
        if (pin === null || pin.operator === '==' || pin.operator === '===') continue;
        violations.push({
          file,
          rule: RULE_ID,
          message: unpinnedMessage(token.line, target.installer, token.text, pin),
          line: token.line,
        });
      }
    }
  }

  return violations;
}

/** A package installed by `pip`, `uv pip` or `pipx` in a workflow `run:` step must be pinned with `==`. */
export function createGithubActionsPipInstallPinnedRule(
  options: GithubActionsPipInstallPinnedOptions = {},
): IMetaRule {
  const workflowGlobs = options.workflowGlobs ?? DEFAULT_WORKFLOW_GLOBS;
  const installers = options.installers ?? DEFAULT_INSTALLERS;
  const ciCritical = options.ciCritical ?? false;
  return {
    id: RULE_ID,
    category: 'ci',
    ciCritical,
    description:
      'Packages installed with pip, uv pip or pipx in a GitHub Actions run step must be pinned to an exact version with ==.',
    run(ctx) {
      return globFiles((p) => ctx.glob(p), workflowGlobs).flatMap((file) =>
        checkWorkflowPipInstallsPinned(file, ctx.read(file) ?? '', installers),
      );
    },
  };
}
