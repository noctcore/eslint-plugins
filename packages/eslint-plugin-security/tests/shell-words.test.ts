import type { TSESTree } from '@typescript-eslint/utils';
import { describe, expect, it } from 'vitest';

import { classifyShellParts } from '../src/shell-words';

/** A stand-in for a runtime value: the scanner only needs its identity. */
const VALUE = { type: 'Identifier', name: 'v' } as unknown as TSESTree.Node;

/**
 * Splits a command written with `$` for each runtime value and returns, for
 * each value, whether it lands in a word that runs as a program.
 */
function commandWords(command: string): boolean[] {
  const segments: (string | TSESTree.Node)[] = [];
  command.split('$').forEach((text, index) => {
    if (index > 0) {
      segments.push(VALUE);
    }
    segments.push(text);
  });
  return classifyShellParts(segments).map((part) => part.commandWord);
}

describe('classifyShellParts', () => {
  it.each([
    '$ -x',
    '"$" -x',
    'ls; $',
    'true || $',
    'a && $',
    'a | $',
    'echo `$`',
    'echo ($)',
    'a\n$',
    '{ $; }',
    'LANG=C $',
    '/usr/bin/$',
    '! $',
    // a wrapper, by basename and with quotes stripped, options included
    'sudo $',
    'sudo -u deploy $',
    'sudo -- $',
    'doas -u x $',
    'env -i $',
    'env -- $',
    '/usr/bin/env $',
    '/usr/bin/sudo $',
    "'sudo' $",
    '\\sudo $',
    'nice -n 5 $',
    'timeout 30 $',
    'echo a | xargs -0 $',
    'stdbuf -oL $',
    'time -p $',
    'nohup $',
    'eval $',
    'sh -c $',
    "bash -c '$'",
    'zsh -c "$"',
    'dash -c $',
    'source $',
    '. $',
    'coproc $',
    'setsid $',
    'chroot / $',
    'ionice -c 3 $',
    'strace -f $',
    'watch -n 1 $',
    'ssh host $',
    'npx $',
    'bunx $',
    'uvx $',
    'pnpm dlx $',
    'npm exec $',
    'yarn dlx $',
    'bun x $',
    'find . -exec $ {} +',
    'find . -execdir $ ;',
    'find . -ok $ ;',
    // a redirect before the program keeps the program position
    '>out $',
    '2>/dev/null $',
    '> out $',
    '<in $',
    '>>log $',
  ])('reads the value in `%s` as a program', (command) => {
    expect(commandWords(command)).toEqual([true]);
  });

  it.each([
    'ls $',
    'git -C $ log',
    'ls 2>&1 $',
    'ls &>out $',
    'ls >$',
    'cmd >out $',
    'find . -name $',
    'pnpm add $',
    'echo sudo $',
  ])('reads the value in `%s` as an argument', (command) => {
    expect(commandWords(command)).toEqual([false]);
  });

  it('keeps the program position after `NAME=value` that holds a value', () => {
    expect(commandWords('NODE_ENV=$ $ --version')).toEqual([true, true]);
    expect(commandWords('A=$ sudo $')).toEqual([true, true]);
    expect(commandWords('A=$ B=$x $')).toEqual([true, true, true]);
    expect(commandWords('A=$ ls $')).toEqual([true, false]);
  });

  it('starts over after a separator', () => {
    expect(commandWords('sudo $; ls $')).toEqual([true, false]);
    expect(commandWords('$ $')).toEqual([true, false]);
  });

  it('marks a value glued after a slash as a path segment', () => {
    const parts = classifyShellParts(['rm -rf /srv/', VALUE, ' --x=', VALUE]);
    expect(parts.map((part) => [part.midWord, part.afterSlash])).toEqual([
      [true, true],
      [true, false],
    ]);
  });
});
