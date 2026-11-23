import type { TSESTree } from '@typescript-eslint/utils';

/*
 * Where each runtime value of a shell command string lands, read from the
 * static text around it: inside a word or at its start, right after a `/`, and
 * whether the word runs as a program.
 *
 * A word runs as a program when it is the first word of a simple command
 * (first in the string, or after `;`, `&`, `|`, `(`, `)`, a backtick or a line
 * break), after `NAME=value`, a redirect (`>out`, `2>/dev/null`) or a reserved
 * word (`!`, `{`, `if`, `then`, `do` ...), or anywhere after a wrapper: a
 * command that runs its arguments as a command (`sudo`, `env`, `xargs`,
 * `sh` ...). After a wrapper every later word up to the next separator counts,
 * options included (`sudo -u deploy ${tool}`, `timeout 30 ${tool}`). Wrappers
 * match by basename and with quotes and backslashes stripped (`/usr/bin/env`,
 * `'sudo'`). `find ... -exec` and `pnpm dlx` / `npm exec` / `yarn dlx` /
 * `bun x` start a wrapped run too.
 *
 * The wrapper list is a list: a command it does not name that runs its
 * arguments is not seen. Quotes do not hide separators here, so
 * `echo "a; ${x}"` reads `${x}` as a program, which only reports more.
 */

/** Commands that run (some of) their arguments as a command. */
export const WRAPPER_COMMANDS: ReadonlySet<string> = new Set([
  '.',
  'bash',
  'builtin',
  'bunx',
  'busybox',
  'chroot',
  'command',
  'coproc',
  'dash',
  'doas',
  'env',
  'eval',
  'exec',
  'fish',
  'flock',
  'ionice',
  'ksh',
  'ltrace',
  'nice',
  'nohup',
  'npx',
  'nsenter',
  'pipx',
  'runuser',
  'setsid',
  'sh',
  'source',
  'ssh',
  'stdbuf',
  'strace',
  'su',
  'sudo',
  'taskset',
  'time',
  'timeout',
  'unshare',
  'uvx',
  'watch',
  'xargs',
  'zsh',
]);

/** Reserved words after which the next word still names a program. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  '!',
  '{',
  '}',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
]);

/** `find` actions whose following words run as a command. */
const FIND_ACTIONS: ReadonlySet<string> = new Set(['-exec', '-execdir', '-ok', '-okdir']);

/** Package runners and the subcommands that run a package's binary. */
const RUNNER_SUBCOMMANDS: Readonly<Record<string, ReadonlySet<string>>> = {
  npm: new Set(['exec', 'x']),
  pnpm: new Set(['dlx', 'exec']),
  yarn: new Set(['dlx', 'exec']),
  bun: new Set(['x']),
};

/** Characters that end a simple command (`&` is read apart, see `isSeparator`). */
const SEPARATORS = ';|()`\n\r';

/** `NAME=value` before a command sets a variable for it. */
const ASSIGNMENT_WORD = /^[A-Za-z_]\w*=/u;

/**
 * A redirect operator, alone (`>`, `2>`) or with its target (`>out`, `2>&1`).
 * Bash's `&>file` is not one: Node runs `/bin/sh`, which is dash on Debian and
 * Ubuntu, where `cmd &>file next` is `cmd &` and then `>file next`.
 */
const REDIRECT_START = /^\d*(?:>>?|<<?|>&|<&|>\|)/u;
const REDIRECT_ONLY = /^\d*(?:>>?|<<?|>&|<&|>\|)$/u;

/**
 * Static text before a value glues it into a word when it ends in a plain word
 * character. A trailing `-` or `+` does not: `tool -${x}` with `x = '-output=f'`
 * makes a long option.
 */
const WORD_END = /[\w=:,./@%]$/u;

/** Where one runtime part of the command lands. */
export interface ShellPart {
  readonly node: TSESTree.Node;
  /** Static text right before it puts it inside a word (`--author=${x}`). */
  readonly midWord: boolean;
  /** It follows a `/` in the same word, as a path segment (`/srv/${x}`). */
  readonly afterSlash: boolean;
  /** The word it is in runs as a program (see the header). */
  readonly commandWord: boolean;
}

/** A dynamic piece inside the word being read is marked with this character. */
const VALUE_MARK = '\u0000';

/** The basename of a word with its quotes and backslashes taken out. */
function commandName(word: string): string {
  const bare = word.replace(/['"\\]/gu, '');
  return bare.slice(bare.lastIndexOf('/') + 1);
}

/**
 * Classifies the runtime parts of a command built from `segments`: static text
 * (from literals and resolved constants) and runtime values, in order.
 */
export function classifyShellParts(segments: readonly (string | TSESTree.Node)[]): ShellPart[] {
  const items: (string | TSESTree.Node)[] = [];
  for (const segment of segments) {
    if (typeof segment === 'string') {
      items.push(...segment);
    } else {
      items.push(segment);
    }
  }

  const parts: ShellPart[] = [];
  let mode: 'command' | 'wrapped' | 'args' = 'command';
  let program: string | null = null;
  let redirectTarget = false;
  // The current word as read (quotes and backslashes left out) and whether it
  // has anything in it.
  let word = '';
  let started = false;

  const endWord = (): void => {
    if (!started) {
      return;
    }
    const text = word;
    word = '';
    started = false;
    if (redirectTarget) {
      redirectTarget = false;
      return;
    }
    if (REDIRECT_ONLY.test(text)) {
      redirectTarget = true;
      return;
    }
    if (REDIRECT_START.test(text)) {
      return;
    }
    if (mode === 'command') {
      if (ASSIGNMENT_WORD.test(text) || RESERVED_WORDS.has(text)) {
        // Still before the program name, whatever the assigned value is
        // (`NODE_ENV=${v} ${tool}`).
      } else if (text.includes(VALUE_MARK)) {
        mode = 'args';
        program = null;
      } else if (WRAPPER_COMMANDS.has(commandName(text))) {
        mode = 'wrapped';
      } else {
        program = commandName(text);
        mode = 'args';
      }
    } else if (mode === 'args') {
      const runner = program === null ? undefined : RUNNER_SUBCOMMANDS[program];
      if (FIND_ACTIONS.has(text) || runner?.has(text) === true) {
        mode = 'wrapped';
      }
    }
  };

  const isSeparator = (index: number): boolean => {
    const char = items[index];
    if (typeof char !== 'string') {
      return false;
    }
    if (char === '&') {
      // `2>&1` and `<&0` are redirects, not a background `&`. `&>file` is
      // read as dash reads it: `&`, then a redirect before the next program
      // (in bash this only reports more).
      const before = items[index - 1];
      return before !== '>' && before !== '<';
    }
    return SEPARATORS.includes(char);
  };

  items.forEach((item, index) => {
    if (typeof item !== 'string') {
      const before = items[index - 1];
      const prefix = word;
      parts.push({
        node: item,
        midWord: typeof before === 'string' && WORD_END.test(before),
        afterSlash: before === '/',
        commandWord: mode !== 'args' && !redirectTarget && !REDIRECT_START.test(prefix),
      });
      word += VALUE_MARK;
      started = true;
      return;
    }
    if (isSeparator(index)) {
      endWord();
      mode = 'command';
      program = null;
      redirectTarget = false;
    } else if (item === ' ' || item === '\t') {
      endWord();
    } else {
      started = true;
      if (item !== "'" && item !== '"' && item !== '\\') {
        word += item;
      }
    }
  });
  return parts;
}
