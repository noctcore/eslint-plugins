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
 * `bun x` start a wrapped run too, and so does a program word that holds a
 * shell parameter (`$SHELL`, `${SUDO:-sudo}`), which can name any program.
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

/**
 * `NAME=value` before a command sets a variable for it, and so do bash's
 * `NAME+=value` and `NAME[i]=value` (`/bin/sh` is bash on macOS, RHEL and
 * Arch). A value in the name is read as a word character, see `isAssignment`.
 */
const ASSIGNMENT_WORD = /^[A-Za-z_]\w*(?:\[.*\])?\+?=/u;

/**
 * The start of a word that may still become an assignment: bash reads
 * `A[ 0 ]=x`, `A["x y"]=1` and `A="x y"` as one word, so a space inside its
 * brackets or quotes (or escaped) does not end it.
 */
const ASSIGNMENT_START = /^[A-Za-z_\u0000][\w\u0000]*(?:\[|\+?=)/u;

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
  /** It follows a `/` in the same word, as a path segment (`/srv/${x}`, `'/srv/'${x}`). */
  readonly afterSlash: boolean;
  /** It is glued right after another runtime value in the same word (`${a}${b}`). */
  readonly afterValue: boolean;
  /** The word it is in runs as a program (see the header). */
  readonly commandWord: boolean;
}

/** A dynamic piece inside the word being read is marked with this character. */
const VALUE_MARK = '\u0000';

/**
 * Whether a word may assign a variable. A value in it stands for a word
 * character, so a value that forms the name (`${name}=x`, `A${p}=x`) keeps
 * the word an assignment, and the word after it is read as the program. That
 * moves reports both ways: in `${n}=x -exec ${t}` and `A+=x -exec ${t}`,
 * `-exec` is the program (not a `find` action), so `t` is an argument there.
 */
function isAssignment(text: string): boolean {
  return ASSIGNMENT_WORD.test(text.replaceAll(VALUE_MARK, 'v'));
}

/** The basename of a word with its quotes and backslashes taken out. */
function commandName(word: string): string {
  const bare = word.replace(/['"\\]/gu, '');
  return bare.slice(bare.lastIndexOf('/') + 1);
}

/**
 * Classifies the runtime parts of a command built from `segments`: static text
 * (from literals and resolved constants) and runtime values, in order.
 *
 * A value in `opaque` is proven but its text is not known (a value the
 * operator sets): it may hold a separator or a wrapper, so every later word up
 * to the next separator in the string runs as a program.
 */
export function classifyShellParts(
  segments: readonly (string | TSESTree.Node)[],
  opaque: ReadonlySet<TSESTree.Node> = new Set(),
): ShellPart[] {
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
  let wordOpaque = false;
  // The quote the scan is inside, and whether the last character was an
  // escaping backslash. Read only to keep an assignment word whole.
  let quote = '';
  let escaped = false;

  /** A space here belongs to an assignment word still being read (see `ASSIGNMENT_START`). */
  const insideAssignment = (): boolean => {
    if (mode !== 'command' || !ASSIGNMENT_START.test(word)) {
      return false;
    }
    const depth = word.split('[').length - word.split(']').length;
    return quote !== '' || escaped || depth > 0;
  };

  const endWord = (): void => {
    if (!started) {
      return;
    }
    const text = word;
    const unknown = wordOpaque;
    word = '';
    started = false;
    wordOpaque = false;
    readWord(text);
    if (unknown) {
      mode = 'wrapped';
      program = null;
    }
  };

  const readWord = (text: string): void => {
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
      if (isAssignment(text) || RESERVED_WORDS.has(text)) {
        // Still before the program name, whatever the assigned value is
        // (`NODE_ENV=${v} ${tool}`) and even when a value forms the name
        // (`${name}=x ${tool}`).
      } else if (text.includes(VALUE_MARK)) {
        mode = 'args';
        program = null;
      } else if (text.includes('$') || WRAPPER_COMMANDS.has(commandName(text))) {
        // A shell parameter (`$SHELL`, `${SUDO:-sudo}`, bash's `$'env'`) can
        // name any program, a wrapper included.
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
      // (in bash this only reports more). An odd run of backslashes before
      // the `>` escapes it (`echo \>&x` is `echo '>' &`, then `x`).
      const before = items[index - 1];
      if (before !== '>' && before !== '<') {
        return true;
      }
      let slashes = 0;
      while (items[index - 2 - slashes] === '\\') {
        slashes += 1;
      }
      return slashes % 2 === 1;
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
        // Read past quotes: `/srv/"${x}"` is still a segment of `/srv/`.
        afterSlash: prefix.endsWith('/'),
        afterValue: prefix.endsWith(VALUE_MARK),
        commandWord: mode !== 'args' && !redirectTarget && !REDIRECT_START.test(prefix),
      });
      word += VALUE_MARK;
      started = true;
      escaped = false;
      wordOpaque ||= opaque.has(item);
      return;
    }
    if (isSeparator(index)) {
      escaped = false;
      endWord();
      mode = 'command';
      program = null;
      redirectTarget = false;
    } else if ((item === ' ' || item === '\t') && !insideAssignment()) {
      escaped = false;
      endWord();
    } else {
      started = true;
      if (escaped) {
        escaped = false;
      } else if (item === '\\' && quote !== "'") {
        escaped = true;
      } else if ((item === "'" || item === '"') && (quote === '' || quote === item)) {
        quote = quote === '' ? item : '';
      }
      if (item !== "'" && item !== '"' && item !== '\\') {
        word += item;
      }
    }
  });
  return parts;
}
