import type { IMetaRule, IViolation } from '@noctcore/harness';

import { workspaceList } from './pnpm-workspace-yaml';
import { asRecord, escapeRegExp, readManifests } from './shared';

/** Options for {@link createSharedToolVersionParityRule}. */
export interface SharedToolVersionParityOptions {
  /** Dependency names compared across packages. Default `['eslint', 'typescript', 'prettier', 'typescript-eslint', '@eslint/js']`. */
  readonly tools?: readonly string[];
  /** Every dependency whose name starts with one of these is compared too, for example `['@acme/']`. Default `[]`. */
  readonly toolPrefixes?: readonly string[];
  /**
   * Workspace package directories, as globs (`packages/*`). A leading `!` excludes. Default: the root
   * `package.json` `workspaces` (array or `{ packages }`), else the `packages:` list of `pnpm-workspace.yaml`.
   */
  readonly workspaces?: readonly string[];
  /** Compare the root `package.json` as one more declarer. Default `true`. */
  readonly includeRoot?: boolean;
  /** `package.json` fields read. Default `['dependencies', 'devDependencies']`. */
  readonly fields?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'shared-tool-version-parity';
const DEFAULT_TOOLS = ['eslint', 'typescript', 'prettier', 'typescript-eslint', '@eslint/js'] as const;
const DEFAULT_FIELDS = ['dependencies', 'devDependencies'] as const;
/** Specifiers that resolve through the workspace or a catalog, so they cannot drift per package. */
const SKIPPED_SPECIFIERS = /^(?:workspace|catalog):/u;

/** The workspace globs the root manifest or `pnpm-workspace.yaml` declares, or `[]`. */
export function declaredWorkspaces(read: (rel: string) => string | null): string[] {
  const root = read('package.json');
  if (root !== null) {
    try {
      const pkg = asRecord(JSON.parse(root));
      const field = pkg?.['workspaces'];
      const list = Array.isArray(field) ? field : asRecord(field)?.['packages'];
      if (Array.isArray(list)) return list.filter((entry): entry is string => typeof entry === 'string');
    } catch {
      // An unparsable root manifest declares nothing; fall through to pnpm.
    }
  }
  const pnpm = read('pnpm-workspace.yaml');
  if (pnpm === null) return [];
  return (workspaceList(pnpm, 'packages')?.items ?? []).map((item) => item.value);
}

function trimSlashes(glob: string): string {
  return glob.replace(/^\.\//u, '').replace(/\/+$/u, '');
}

/** A glob as a whole-path regex: `**` spans directories, `*` stays in one segment. */
function globRegExp(glob: string): RegExp {
  const source = glob
    .split('**')
    .map((part) => part.split('*').map(escapeRegExp).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`, 'u');
}

/** The `package.json` files of the workspace packages, plus the root one when asked for. */
function manifestFiles(
  glob: (pattern: string) => string[],
  workspaces: readonly string[],
  includeRoot: boolean,
): string[] {
  const include = workspaces.filter((entry) => !entry.startsWith('!')).map(trimSlashes);
  const exclude = workspaces
    .filter((entry) => entry.startsWith('!'))
    .map((entry) => globRegExp(trimSlashes(entry.slice(1))));
  const files = new Set<string>();
  for (const entry of include) {
    for (const file of glob(`${entry}/package.json`)) {
      const dir = file.replace(/\/?package\.json$/u, '');
      if (!exclude.some((pattern) => pattern.test(dir))) files.add(file);
    }
  }
  if (includeRoot) files.add('package.json');
  return [...files].sort();
}

/** The 1-based line of `"name":` inside the `field` object of a manifest's text, or undefined. */
function declarationLine(text: string, field: string, name: string): number | undefined {
  const lines = text.split('\n');
  const fieldIndex = lines.findIndex((line) => new RegExp(`^\\s*"${escapeRegExp(field)}"\\s*:`, 'u').test(line));
  const key = new RegExp(`^\\s*"${escapeRegExp(name)}"\\s*:`, 'u');
  for (let index = Math.max(fieldIndex, 0); index < lines.length; index += 1) {
    if (key.test(lines[index] ?? '')) return index + 1;
  }
  return undefined;
}

interface Declaration {
  readonly file: string;
  readonly field: string;
  readonly version: string;
  readonly line: number | undefined;
}

/**
 * Two workspace packages that declare the same dev tool declare the same
 * version. A tool declared by one package only is never reported, so a package
 * that does not use a tool is never asked to add it. Versions are compared as
 * written: `^5.6.0` and `5.6.0` are drift under an exact-pin policy.
 */
export function createSharedToolVersionParityRule(options: SharedToolVersionParityOptions = {}): IMetaRule {
  const tools = new Set(options.tools ?? DEFAULT_TOOLS);
  const toolPrefixes = options.toolPrefixes ?? [];
  const includeRoot = options.includeRoot ?? true;
  const fields = options.fields ?? DEFAULT_FIELDS;
  const ciCritical = options.ciCritical ?? true;
  const isTool = (name: string): boolean => tools.has(name) || toolPrefixes.some((prefix) => name.startsWith(prefix));

  return {
    id: RULE_ID,
    category: 'config',
    ciCritical,
    description:
      'Workspace packages that declare the same dev tool (eslint, typescript, prettier, or a configured prefix) must declare the same version; `workspace:` and `catalog:` specifiers are skipped.',
    run(ctx) {
      const workspaces = options.workspaces ?? declaredWorkspaces((rel) => ctx.read(rel));
      const files = manifestFiles((pattern) => ctx.glob(pattern), workspaces, includeRoot);
      const byTool = new Map<string, Declaration[]>();
      const violations: IViolation[] = [];

      for (const manifest of readManifests(ctx, files)) {
        if (!manifest.ok) continue;
        const text = ctx.read(manifest.file) ?? '';
        for (const field of fields) {
          const deps = asRecord(manifest.pkg[field]);
          if (deps === null) continue;
          for (const [name, version] of Object.entries(deps)) {
            if (typeof version !== 'string' || !isTool(name) || SKIPPED_SPECIFIERS.test(version)) continue;
            const list = byTool.get(name) ?? [];
            list.push({ file: manifest.file, field, version, line: declarationLine(text, field, name) });
            byTool.set(name, list);
          }
        }
      }

      for (const [tool, declarations] of [...byTool].sort(([a], [b]) => a.localeCompare(b))) {
        const packages = new Set(declarations.map((declaration) => declaration.file));
        const versions = [...new Set(declarations.map((declaration) => declaration.version))].sort();
        if (packages.size < 2 || versions.length < 2) continue;
        const summary = versions
          .map((version) => {
            const where = declarations.filter((d) => d.version === version).map((d) => d.file);
            return `\`${version}\` in ${[...new Set(where)].join(', ')}`;
          })
          .join('; ');
        for (const declaration of declarations) {
          const at = declaration.line === undefined ? '' : `line ${String(declaration.line)}: `;
          violations.push({
            file: declaration.file,
            rule: RULE_ID,
            ...(declaration.line === undefined ? {} : { line: declaration.line }),
            message: `${at}${declaration.field}.${tool} is \`${declaration.version}\`, but ${String(packages.size)} workspace packages declare ${tool} at ${String(versions.length)} versions (${summary}). Declare one version everywhere, so every package lints, formats and type-checks with the same tool.`,
          });
        }
      }
      return violations;
    },
  };
}
