import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import {
  parsePrismaSchema,
  reconcileTenantRegistry,
  type ParsedPrismaSchema,
  type TenantRegistry,
} from '@noctcore/eslint-plugin-prisma';

import { firstOptionOf, resolveRules, severityOf } from '../resolved-config/resolve';
import { stripTrailingSlashes } from '../rules/shared';

/** Where the runtime scope map is declared, when it is read from source. */
export interface ScopedModelsSource {
  /** File declaring the map, e.g. the tenant-scope client extension. */
  readonly file: string;
  /** Name of the `const` whose object-literal KEYS are the scoped delegate accessors. */
  readonly exportName: string;
}

/**
 * The STATIC side: the lint config whose tenant rules must receive the registry.
 * Read from the RESOLVED config, so it asserts what the rules actually get.
 */
export interface TenantRegistryEslintOptions {
  /** Directory whose ESLint config is resolved. Default `.`. */
  readonly cwd?: string;
  /** File, relative to `cwd`, the config is resolved for; match your tenant rules' glob. Default `src/__lint_meta_probe__.ts`. */
  readonly probe?: string;
  /**
   * Rules whose `modelsOption` must equal the scoped models. Default the three
   * `noctcore-prisma` tenant rules.
   */
  readonly modelRules?: readonly string[];
  /** The option those rules take the model list in. Default `tenantModels`. */
  readonly modelsOption?: string;
  /**
   * The rule whose `handScopedOption` must equal `registry.handScopedModels`, or
   * `null` to skip. Default `noctcore-prisma/tenant-scoped-tables-require-where`.
   */
  readonly handScopedRule?: string | null;
  /** The option that rule takes the hand-scope map in. Default `handScopedModels`. */
  readonly handScopedOption?: string;
  /** Path reported for config-side violations. Default: `cwd`. */
  readonly configFile?: string;
}

/**
 * Options for {@link createTenantModelRegistryParityRule}.
 *
 * Every path is relative to the repo root the harness runs in.
 */
export interface TenantModelRegistryParityOptions {
  /** Rule id, for running more than one instance. Default `tenant-model-registry-parity`. */
  readonly id?: string;
  /**
   * The Prisma schema: a `.prisma` file, or a folder whose `.prisma` files
   * (recursively) are read together. Default `prisma/schema.prisma`.
   */
  readonly schemaPath?: string;
  /**
   * The columns that make a model tenant-bearing: a model carrying ALL of them
   * must be scoped or exempt. Default `['tenantId']`.
   */
  readonly tenantFields?: readonly string[];
  /**
   * The project's registry, injected as data (`TenantRegistry` from
   * `@noctcore/eslint-plugin-prisma`). `scopedModels` is ignored when
   * `scopedModelsSource` is set. Default: empty.
   */
  readonly registry?: TenantRegistry;
  /**
   * Read the scoped models from the runtime source instead of
   * `registry.scopedModels`: the keys of an object literal
   * (`export const SCOPED = { invoice: [...], ... }`). Prefer this when the
   * runtime map is the source of truth, so the check reads it rather than a copy.
   */
  readonly scopedModelsSource?: ScopedModelsSource;
  /**
   * Require every unscoped-by-design model to name its hand-scope columns
   * (`registry.handScopedModels`) or record why it cannot
   * (`registry.handScopePending`). Default `true`.
   */
  readonly requireHandScope?: boolean;
  /** The static side, or `false` to check only the registry against the schema. */
  readonly eslint?: TenantRegistryEslintOptions | false;
  /**
   * Path reported for registry-side violations (the hand-scope maps, and the
   * schema reconciliation when there is no `scopedModelsSource`). Default:
   * `scopedModelsSource.file`, else `schemaPath`.
   */
  readonly registryFile?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'tenant-model-registry-parity';
const DEFAULT_SCHEMA_PATH = 'prisma/schema.prisma';
const DEFAULT_TENANT_FIELDS = ['tenantId'];
const DEFAULT_PROBE = 'src/__lint_meta_probe__.ts';
const DEFAULT_MODEL_RULES = [
  'noctcore-prisma/no-cross-tenant-id-in-where',
  'noctcore-prisma/tenant-scoped-tables-require-where',
  'noctcore-prisma/tenant-write-must-carry-tenant-id',
];
const DEFAULT_HAND_SCOPED_RULE = 'noctcore-prisma/tenant-scoped-tables-require-where';

/** Blank line and block comments and string literals, preserving offsets. */
function blankCommentsAndStrings(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      while (i < source.length && source[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i += 1) if (source[i] !== '\n') out[i] = ' ';
      continue;
    }
    const quote = source[i];
    if (quote === "'" || quote === '"' || quote === '`') {
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') out[i++] = ' ';
        if (i < source.length && source[i] !== '\n') out[i] = ' ';
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const OPENERS = new Set(['{', '[', '(']);
const CLOSERS = new Set(['}', ']', ')']);

/**
 * Top-level keys of the object literal assigned to `exportName`, or `null` when
 * the declaration cannot be located (reported, never read as an empty map).
 *
 * Reads a comment- and string-blanked copy while tracking bracket depth, so a
 * nested object or an array holding a `:` is never mistaken for an entry.
 * Quoted keys (`'invoice': [...]`) are blanked with the strings, so a map must
 * use identifier keys, as a delegate-accessor map does.
 */
export function parseObjectLiteralKeys(source: string, exportName: string): string[] | null {
  const blanked = blankCommentsAndStrings(source);
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const declaration = new RegExp(`\\b${escaped}\\s*(?::[^=]+)?=\\s*\\{`, 'u').exec(blanked);
  if (declaration === null) return null;

  const open = declaration.index + declaration[0].length - 1;
  const keys: string[] = [];
  let depth = 0;
  let token = '';
  for (let i = open; i < blanked.length; i += 1) {
    const char = blanked[i] ?? '';
    if (OPENERS.has(char)) {
      depth += 1;
      token = '';
    } else if (CLOSERS.has(char)) {
      depth -= 1;
      token = '';
      if (depth === 0) return keys;
    } else if (depth === 1 && char === ':') {
      const key = token.trim();
      if (/^[A-Za-z_$][\w$]*$/u.test(key)) keys.push(key);
      token = '';
    } else if (depth === 1 && char === ',') {
      token = '';
    } else if (depth === 1) {
      token += char;
    }
  }
  return null;
}

/** The schema at `schemaPath` (a file or a folder of `.prisma` files), or `null`. */
function readSchema(ctx: IMetaCtx, schemaPath: string): ParsedPrismaSchema | null {
  const base = stripTrailingSlashes(schemaPath);
  const files = ctx.glob(`${base}/**/*.prisma`).sort();
  // Concatenated, not parsed per file: a relation's target may be declared in a
  // different file than the field pointing at it.
  const texts = files.length > 0 ? files.map((file) => ctx.read(file) ?? '') : [ctx.read(base)];
  if (texts.some((text) => text === null)) return null;
  const parsed = parsePrismaSchema(texts.join('\n'));
  return parsed.models.length > 0 ? parsed : null;
}

/** A stable string for comparing two model -> columns maps. */
function fingerprint(models: Readonly<Record<string, readonly string[]>>): string {
  return Object.keys(models)
    .sort()
    .map((model) => `${model}:${[...(models[model] ?? [])].sort().join('+')}`)
    .join(',');
}

/** The hand-scope half: every exemption names its columns or why it has none. */
function handScopeMessages(registry: TenantRegistry): string[] {
  const unscoped = registry.unscopedByDesign;
  const handScoped = registry.handScopedModels ?? {};
  const pending = registry.handScopePending ?? {};
  const messages: string[] = [];

  for (const model of Object.keys(unscoped)) {
    if (Object.hasOwn(handScoped, model) || Object.hasOwn(pending, model)) continue;
    messages.push(
      `\`${model}\` is exempt from the tenant-scope extension but has no \`handScopedModels\` entry, so "scoped by hand" is enforced by nothing. List the column(s) every query on it must filter by, or record why it cannot have one in \`handScopePending\`.`,
    );
  }
  for (const model of Object.keys(handScoped)) {
    if (!Object.hasOwn(unscoped, model)) {
      messages.push(
        `\`${model}\` has a \`handScopedModels\` entry but is not exempt from the extension, so the static guard polices a model the runtime boundary already scopes. Drop the entry, or add the exemption it belongs to.`,
      );
    }
  }
  for (const model of Object.keys(pending)) {
    if (!Object.hasOwn(unscoped, model)) {
      messages.push(
        `\`${model}\` is recorded in \`handScopePending\` but is not exempt from the extension any more. The note is stale: delete it.`,
      );
    }
  }
  return messages;
}

/**
 * The tenant-model registries must mirror each other AND the Prisma schema.
 *
 * A multi-tenant Prisma project keeps "which models are tenant-scoped?" in two
 * hand-maintained places, the runtime scope map and the model list its tenant
 * lint rules are configured with, and agreement between those two says nothing
 * about a table neither has heard of. So the SCHEMA is the third input: every
 * model carrying the tenant columns must be scoped or explicitly exempt with a
 * reason, and a new tenant-bearing model cannot ship without the guardrails
 * learning about it.
 *
 * The static side is read from the RESOLVED ESLint config, not by parsing the
 * config file: moving the array, spreading a different preset, or handing one
 * rule a hand-written list is all caught. Fails closed on an unreadable schema,
 * runtime map or config. Needs the optional `eslint` peer unless `eslint: false`.
 */
export function createTenantModelRegistryParityRule(
  options: TenantModelRegistryParityOptions = {},
): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  const tenantFields = options.tenantFields ?? DEFAULT_TENANT_FIELDS;
  const registry: TenantRegistry = options.registry ?? { scopedModels: [], unscopedByDesign: {} };
  const source = options.scopedModelsSource;
  const registryFile = options.registryFile ?? source?.file ?? schemaPath;
  const requireHandScope = options.requireHandScope ?? true;
  const eslint = options.eslint === false ? null : (options.eslint ?? {});

  return {
    id,
    category: 'config',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every tenant-bearing Prisma model is scoped by the runtime extension or exempt with a reason, and the tenant lint rules resolve with exactly that registry.',
    async runAsync(ctx) {
      const violations: IViolation[] = [];
      const report = (file: string, message: string): void => {
        violations.push({ file, rule: id, message });
      };

      let scopedModels: readonly string[] = registry.scopedModels;
      if (source !== undefined) {
        const text = ctx.read(source.file);
        const keys = text === null ? null : parseObjectLiteralKeys(text, source.exportName);
        if (keys === null || keys.length === 0) {
          // An unreadable runtime map must never read as "nothing is scoped".
          report(
            source.file,
            `Could not read the \`${source.exportName}\` object literal in ${source.file}, so the runtime scope map cannot be checked. The rule expects \`const ${source.exportName} = { model: ..., ... }\`; if the declaration moved or changed shape, update \`scopedModelsSource\` rather than dropping the check.`,
          );
          return violations;
        }
        scopedModels = keys;
      }

      if (requireHandScope) {
        for (const message of handScopeMessages(registry)) report(registryFile, message);
      }

      const parsed = readSchema(ctx, schemaPath);
      if (parsed === null) {
        report(
          schemaPath,
          `Could not read a Prisma schema with any model at "${schemaPath}", so tenant-bearing models cannot be derived. Point \`schemaPath\` at the schema file or folder rather than dropping the check.`,
        );
      } else {
        for (const message of reconcileTenantRegistry({
          parsed,
          tenantFields,
          scopedModels,
          unscopedByDesign: registry.unscopedByDesign,
        }).messages) {
          report(source?.file ?? registryFile, message);
        }
      }

      if (eslint === null) return violations;

      const cwd = eslint.cwd ?? '.';
      const configFile = eslint.configFile ?? cwd;
      const modelsOption = eslint.modelsOption ?? 'tenantModels';
      const handScopedOption = eslint.handScopedOption ?? 'handScopedModels';
      const handScopedRule =
        eslint.handScopedRule === undefined ? DEFAULT_HAND_SCOPED_RULE : eslint.handScopedRule;

      const outcome = await resolveRules(ctx.root, cwd, [eslint.probe ?? DEFAULT_PROBE]);
      if (!outcome.ok) {
        // The schema findings above stand: they do not depend on ESLint.
        report(
          configFile,
          `Could not resolve the effective ESLint config for "${cwd}", so the tenant rules' registry cannot be checked (if it imports a workspace package, build that first): ${outcome.error}`,
        );
        return violations;
      }
      const rules = outcome.rules[0] ?? {};
      const scopedSet = new Set(scopedModels);

      for (const ruleId of eslint.modelRules ?? DEFAULT_MODEL_RULES) {
        const entry = rules[ruleId];
        const raw = firstOptionOf(entry)?.[modelsOption];
        if (severityOf(entry) === 0) {
          report(
            configFile,
            `"${ruleId}" is off (or not configured) for "${cwd}", so nothing statically polices the ${String(scopedModels.length)} tenant-scoped model(s). Enable it with \`${modelsOption}\` set to the scoped models.`,
          );
          continue;
        }
        if (!Array.isArray(raw) || !raw.every((model) => typeof model === 'string')) {
          report(
            configFile,
            `"${ruleId}" resolves with no \`${modelsOption}\` option for "${cwd}", so it falls back to its default and does not police the ${String(scopedModels.length)} tenant-scoped model(s). Pass the scoped models to it.`,
          );
          continue;
        }
        const configured = new Set(raw as string[]);
        for (const model of scopedModels) {
          if (!configured.has(model)) {
            report(
              configFile,
              `\`${model}\` is tenant-scoped at runtime but is MISSING from the \`${modelsOption}\` option of "${ruleId}", so no static rule polices it. Add it to the list the config passes.`,
            );
          }
        }
        for (const model of configured) {
          if (!scopedSet.has(model)) {
            report(
              configFile,
              `\`${model}\` is in the \`${modelsOption}\` option of "${ruleId}" but is not tenant-scoped at runtime, so lint guards a model the runtime boundary does not isolate. Scope it at runtime, or drop it from the list the config passes.`,
            );
          }
        }
      }

      const expectedHandScoped = registry.handScopedModels ?? {};
      if (handScopedRule !== null && Object.keys(expectedHandScoped).length > 0) {
        const raw = firstOptionOf(rules[handScopedRule])?.[handScopedOption];
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
          report(
            configFile,
            `"${handScopedRule}" resolves with no \`${handScopedOption}\` option for "${cwd}", so the models the extension does NOT scope (${Object.keys(expectedHandScoped).sort().join(', ')}) are policed by nothing. Pass the registry's hand-scope map to it.`,
          );
        } else {
          const resolved = fingerprint(raw as Record<string, readonly string[]>);
          const expected = fingerprint(expectedHandScoped);
          if (resolved !== expected) {
            report(
              configFile,
              `The \`${handScopedOption}\` option "${handScopedRule}" resolves to does not match the registry (resolved: ${resolved}; expected: ${expected}). Pass the registry map itself rather than a hand-written copy.`,
            );
          }
        }
      }

      return violations;
    },
  };
}
