
import { fileMatchesAnyGlob, globToRegExp, toPosixPath } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-restricted-imports-layered';

/** One banned module (or module family) inside a named ban set. */
export interface ImportBan {
  /** Globs matched against the import specifier, or against any of its parent paths. */
  readonly modules: readonly string[];
  /** Ban only these named imports (`default` for the default import). */
  readonly importNames?: readonly string[];
  /** Allow `import type` and type-only specifiers. */
  readonly allowTypeImports?: boolean;
  /** Appended to the report: what to do instead. */
  readonly message?: string;
}

/** Which ban sets apply to which files. */
export interface ImportLayer {
  readonly files: readonly string[];
  readonly ignores?: readonly string[];
  readonly bans: readonly string[];
}

export interface NoRestrictedImportsLayeredOptions {
  readonly bans?: Readonly<Record<string, readonly ImportBan[]>>;
  readonly layers?: readonly ImportLayer[];
}

type RuleOptions = [NoRestrictedImportsLayeredOptions];
type MessageIds = 'banned' | 'bannedName';

/*
 * Flat config does not merge `no-restricted-imports` across blocks: for a file,
 * the last matching block's options replace every earlier block's. A repo that
 * bans an SDK everywhere and adds a layer ban for one directory has to repeat
 * the SDK ban in the layer block, and the repetition drifts. The built-in rule
 * also never sees a dynamic `import()`, so the same bans get written a second
 * time as `no-restricted-syntax` selectors.
 *
 * This rule takes the bans once, as named sets, and the layers as a list of
 * `files` / `ignores` globs naming the sets that apply. Every layer that
 * matches a file contributes its sets, so the bans merge instead of overriding.
 * It checks static imports, re-exports (`export ... from`, `export * from`) and
 * dynamic `import()` with a literal specifier.
 *
 * A module glob matches the specifier or any parent path of it, the way a
 * `no-restricted-imports` group does: `@/features` bans `@/features/billing`
 * too, and an SDK name bans its subpath exports. Relative and aliased
 * spellings are separate strings, so list both (`@/features` and a glob
 * starting with `**` for the relative form). Inert without options.
 */
const banSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['modules'],
  properties: {
    modules: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      uniqueItems: true,
      description:
        'Globs matched against the import specifier or any of its parent paths (`@/features` also bans `@/features/billing`).',
    },
    importNames: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      uniqueItems: true,
      description: 'Ban only these named imports; `default` is the default import.',
    },
    allowTypeImports: {
      type: 'boolean',
      description: 'Allow `import type` and type-only specifiers from the banned modules.',
    },
    message: {
      type: 'string',
      description: 'Appended to the report, usually what to import instead.',
    },
  },
};

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bans: {
      type: 'object',
      description: 'Named ban sets, declared once and referenced by name from `layers`.',
      additionalProperties: { type: 'array', items: banSchema },
    },
    layers: {
      type: 'array',
      description: 'Which ban sets apply where. Every layer matching a file adds its sets.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['files', 'bans'],
        properties: {
          files: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'File-path globs this layer applies to.',
          },
          ignores: {
            type: 'array',
            items: { type: 'string' },
            description: 'File-path globs excluded from this layer.',
          },
          bans: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            uniqueItems: true,
            description: 'Names of the ban sets that apply.',
          },
        },
      },
    },
  },
};

interface ActiveBan {
  readonly set: string;
  readonly ban: ImportBan;
  readonly patterns: readonly RegExp[];
}

/** An imported binding: its name and whether it is type-only. */
interface ImportedName {
  readonly name: string;
  readonly typeOnly: boolean;
  readonly node: TSESTree.Node;
}

/** The specifier and its parent paths: `a/b/c` -> `a/b/c`, `a/b`, `a`. */
function specifierAndParents(specifier: string): string[] {
  const segments = toPosixPath(specifier).split('/');
  const out: string[] = [];
  for (let end = segments.length; end > 0; end -= 1) {
    out.push(segments.slice(0, end).join('/'));
  }
  return out;
}

/** The static string of an `import()` source, or null for a computed one. */
function literalSource(node: TSESTree.Expression): string | null {
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

function nameOf(node: TSESTree.Identifier | TSESTree.StringLiteral): string {
  return node.type === AST_NODE_TYPES.Identifier ? node.name : node.value;
}

export const noRestrictedImportsLayeredRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Import bans declared once as named sets and assigned to file layers, merged per file instead of overridden, covering static imports, re-exports and dynamic `import()`.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      banned: '`{{source}}` is banned here (ban set `{{set}}`).{{message}}',
      bannedName: '`{{name}}` from `{{source}}` is banned here (ban set `{{set}}`).{{message}}',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const sets = options.bans ?? {};
    // Layer globs read like flat-config `files`: relative to the working
    // directory (or the workspace root). The absolute path is tried too, so
    // `**/`-anchored globs work.
    const matchesFile = (globs: readonly string[]): boolean =>
      fileMatchesAnyGlob(context.filename, globs, context.cwd);
    const active: ActiveBan[] = [];
    const seenSets = new Set<string>();
    for (const layer of options.layers ?? []) {
      if (!matchesFile(layer.files) || matchesFile(layer.ignores ?? [])) {
        continue;
      }
      for (const setName of layer.bans) {
        if (seenSets.has(setName)) {
          continue;
        }
        seenSets.add(setName);
        const entries = sets[setName];
        if (entries === undefined) {
          throw new Error(
            `${RULE_NAME}: a layer names the ban set "${setName}", which \`bans\` does not declare.`,
          );
        }
        for (const ban of entries) {
          active.push({ set: setName, ban, patterns: ban.modules.map((glob) => globToRegExp(glob)) });
        }
      }
    }
    if (active.length === 0) {
      return {};
    }

    function bansFor(source: string): ActiveBan[] {
      const candidates = specifierAndParents(source);
      return active.filter(({ patterns }) =>
        candidates.some((candidate) => patterns.some((pattern) => pattern.test(candidate))),
      );
    }

    function suffix(ban: ImportBan): string {
      return ban.message === undefined ? '' : ` ${ban.message}`;
    }

    /**
     * Check one import. `names` is null when the imported names cannot be known
     * (a dynamic `import()`), and empty for a side-effect import.
     */
    function check(
      sourceNode: TSESTree.Node,
      source: string,
      typeOnly: boolean,
      names: readonly ImportedName[] | null,
    ): void {
      const reportedNames = new Set<string>();
      for (const { set, ban } of bansFor(source)) {
        const data = { source, set, message: suffix(ban) };
        if (ban.allowTypeImports === true && typeOnly) {
          continue;
        }
        const relevant =
          names === null
            ? null
            : names.filter((name) => !(ban.allowTypeImports === true && name.typeOnly));
        if (ban.importNames === undefined) {
          // A whole-module ban: one report per import, from the first set that bans it.
          if (relevant !== null && names !== null && names.length > 0 && relevant.length === 0) {
            continue;
          }
          context.report({ node: sourceNode, messageId: 'banned', data });
          return;
        }
        if (relevant === null) {
          // The names a dynamic import reaches are unknown; a name ban cannot apply.
          continue;
        }
        for (const imported of relevant) {
          if (imported.name !== '*' && !ban.importNames.includes(imported.name)) {
            continue;
          }
          if (reportedNames.has(imported.name)) {
            continue;
          }
          reportedNames.add(imported.name);
          context.report({
            node: imported.node,
            messageId: 'bannedName',
            data: { source, set, message: data.message, name: imported.name },
          });
        }
      }
    }

    return {
      ImportDeclaration(node): void {
        const names: ImportedName[] = node.specifiers.map((specifier) => {
          if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
            return { name: 'default', typeOnly: false, node: specifier };
          }
          if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
            return { name: '*', typeOnly: false, node: specifier };
          }
          return {
            name: nameOf(specifier.imported),
            typeOnly: specifier.importKind === 'type',
            node: specifier,
          };
        });
        check(node.source, node.source.value, node.importKind === 'type', names);
      },
      ExportNamedDeclaration(node): void {
        if (node.source === null) {
          return;
        }
        const names: ImportedName[] = node.specifiers.map((specifier) => ({
          name: nameOf(specifier.local),
          typeOnly: specifier.exportKind === 'type',
          node: specifier,
        }));
        check(node.source, node.source.value, node.exportKind === 'type', names);
      },
      ExportAllDeclaration(node): void {
        check(node.source, node.source.value, node.exportKind === 'type', [
          { name: '*', typeOnly: node.exportKind === 'type', node: node.source },
        ]);
      },
      ImportExpression(node): void {
        const source = literalSource(node.source);
        if (source !== null) {
          check(node.source, source, false, null);
        }
      },
    };
  },
});
