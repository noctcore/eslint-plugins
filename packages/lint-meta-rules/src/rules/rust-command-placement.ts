import type { IMetaRule, IViolation } from '@noctcore/harness';

import { matchesAnyGlob } from './glob-match';
import { lineAt, rustFiles, rustScanText } from './rust-source';

/** Options for {@link createRustCommandPlacementRule}. */
export interface RustCommandPlacementOptions {
  /** Rule id. Default `'rust-command-placement'`. */
  readonly id?: string;
  /** Directories whose `.rs` files are checked, recursively. Default `['src', 'crates/*\/src']`. */
  readonly roots?: readonly string[];
  /** Globs where a command may live; a command anywhere else is reported. Default `[]` (no allow list). */
  readonly allowIn?: readonly string[];
  /** Globs where a command must not live. Default `[]` (no deny list). */
  readonly denyIn?: readonly string[];
  /** Regex source of the attribute that marks a command. Default `#\[(?:tauri::)?command\b`. */
  readonly attribute?: string;
  /** Leave `#[cfg(test)] mod` blocks out of the scan. Default `true`. */
  readonly skipTestModules?: boolean;
  /** Globs of files never checked. Default `[]`. */
  readonly exclude?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ROOTS = ['src', 'crates/*/src'] as const;
const DEFAULT_ATTRIBUTE = String.raw`#\[(?:tauri::)?command\b`;

/**
 * IPC command handlers live where the project says they do. With `allowIn`, a
 * command attribute outside those globs is reported; with `denyIn`, one inside
 * them is. Both may be set. Comments, string contents and test modules are not
 * read, so a doc comment that spells the attribute is not a command.
 */
export function createRustCommandPlacementRule(options: RustCommandPlacementOptions = {}): IMetaRule {
  const id = options.id ?? 'rust-command-placement';
  const roots = options.roots ?? DEFAULT_ROOTS;
  const allowIn = options.allowIn ?? [];
  const denyIn = options.denyIn ?? [];
  const attribute = new RegExp(options.attribute ?? DEFAULT_ATTRIBUTE, 'u');
  const skipTestModules = options.skipTestModules ?? true;
  const exclude = options.exclude ?? [];
  const ciCritical = options.ciCritical ?? true;

  return {
    id,
    category: 'source-text',
    ciCritical,
    description:
      'A command handler attribute (default #[tauri::command]) may appear only in the allowed files, and never in the denied ones.',
    run(ctx) {
      if (allowIn.length === 0 && denyIn.length === 0) return [];
      const violations: IViolation[] = [];
      for (const file of rustFiles((pattern) => ctx.glob(pattern), roots, exclude)) {
        const denied = matchesAnyGlob(file, denyIn);
        const outside = allowIn.length > 0 && !matchesAnyGlob(file, allowIn);
        if (!denied && !outside) continue;
        const scan = rustScanText(ctx.read(file) ?? '', skipTestModules);
        const match = attribute.exec(scan);
        if (match === null) continue;
        const line = lineAt(scan, match.index);
        const where = denied
          ? 'a file where commands are denied (`denyIn`)'
          : 'a file outside the command surface (`allowIn`)';
        violations.push({
          file,
          rule: id,
          line,
          message: `line ${String(line)}: command handler in ${where}. Move the handler to the command surface${allowIn.length > 0 ? ` (${allowIn.join(', ')})` : ''} and keep this module free of IPC.`,
        });
      }
      return violations;
    },
  };
}
