import { describe, expect, test } from 'bun:test';

import { createRustCommandPlacementRule } from '../../src/rules/rust-command-placement';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const RULE_ID = 'rust-command-placement';
const COMMAND = '#[tauri::command]\npub fn open() {}\n';

function run(files: Record<string, string>, options = {}) {
  return createRustCommandPlacementRule(options).run(createFakeCtx({ files }));
}

describe('rust-command-placement', () => {
  test('allowIn: reports a command outside the allowed files, with file and line', () => {
    const violations = run(
      {
        'src/commands/files.rs': COMMAND,
        'src/store/files.rs': `//! Store.\n${COMMAND}`,
      },
      { allowIn: ['src/commands/**'] },
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('src/store/files.rs');
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.message ?? '').toMatch(/^line 2: command handler in a file outside the command surface/u);
    expect(violations[0]?.message ?? '').toContain('(src/commands/**)');
  });

  test('denyIn: reports a command inside a denied module and accepts one elsewhere', () => {
    const files = { 'src/store/files.rs': COMMAND, 'src/store.rs': COMMAND, 'src/workflow/run.rs': COMMAND };
    const violations = run(files, { denyIn: ['src/store/**', 'src/store.rs'] });

    expect(violations.map((violation) => violation.file)).toEqual(['src/store.rs', 'src/store/files.rs']);
    expect(violations[0]?.message ?? '').toContain('where commands are denied');
  });

  test('both lists: a denied file inside the allow list is still reported', () => {
    const files = { 'src/commands/internal/x.rs': COMMAND, 'src/commands/open.rs': COMMAND };

    expect(
      run(files, { allowIn: ['src/commands/**'], denyIn: ['src/commands/internal/**'] }).map((violation) => violation.file),
    ).toEqual(['src/commands/internal/x.rs']);
  });

  test('is inert with neither list', () => {
    expect(run({ 'src/store/files.rs': COMMAND })).toEqual([]);
  });

  test('matches the bare and the qualified attribute, with arguments', () => {
    const options = { allowIn: ['src/commands/**'] };

    expect(run({ 'src/a.rs': '#[command]\nfn a() {}\n' }, options)).toHaveLength(1);
    expect(run({ 'src/a.rs': '#[tauri::command(rename_all = "snake_case")]\nfn a() {}\n' }, options)).toHaveLength(1);
    expect(run({ 'src/a.rs': '#[commander]\nfn a() {}\n' }, options)).toEqual([]);
  });

  test('does not read comments, strings or test modules', () => {
    const text = [
      '//! Handlers moved up to the command layer; no #[tauri::command] here.',
      '/* #[tauri::command] */',
      'const HINT: &str = "#[tauri::command]";',
      '#[cfg(test)]',
      'mod tests {',
      '    #[tauri::command]',
      '    fn fake() {}',
      '}',
      '',
    ].join('\n');
    const options = { allowIn: ['src/commands/**'] };

    expect(run({ 'src/store/files.rs': text }, options)).toEqual([]);
    expect(run({ 'src/store/files.rs': text }, { ...options, skipTestModules: false })).toHaveLength(1);
  });

  test('reports once per file', () => {
    expect(run({ 'src/a.rs': `${COMMAND}${COMMAND}` }, { allowIn: ['src/commands/**'] })).toHaveLength(1);
  });

  test('attribute, roots and exclude', () => {
    const files = { 'crates/ipc/src/a.rs': '#[ipc::handler]\nfn a() {}\n', 'src/store/tests.rs': COMMAND };

    expect(run(files, { allowIn: ['src/commands/**'] }).map((violation) => violation.file)).toEqual([
      'src/store/tests.rs',
    ]);
    expect(run(files, { allowIn: ['src/commands/**'], exclude: ['**/tests.rs'] })).toEqual([]);
    expect(
      run(files, { allowIn: ['src/commands/**'], attribute: String.raw`#\[ipc::handler\b`, roots: ['crates'] }),
    ).toHaveLength(1);
  });

  test('ciCritical defaults to true and can be turned off', () => {
    expect(createRustCommandPlacementRule().ciCritical).toBe(true);
    expect(createRustCommandPlacementRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
