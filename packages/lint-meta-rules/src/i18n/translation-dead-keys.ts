import path from 'node:path';

import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import {
  type Catalog,
  type CatalogSource,
  catalogsForNamespace,
  createTranslationVisitor,
  TRANSLATION_DEFAULTS,
  type TranslationKeyExistsOptions,
  translationSettingsOf,
  type TranslationUsage,
} from '@noctcore/eslint-plugin-contracts';
import * as tsParser from '@typescript-eslint/parser';
import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import { Linter, type Rule } from 'eslint';

import { DEFAULT_SKIP_DIRS, escapeRegExp, globFiles } from '../rules/shared';

/**
 * Options for {@link createTranslationDeadKeysRule}.
 *
 * Every resolution option (`defaultNamespace`, `hooks`, `namespaceIdentifiers`,
 * separators, ...) is the SAME option `noctcore-contracts/translation-key-exists`
 * takes, and is resolved by the same code, so the two checks cannot disagree on
 * which key a call site means. Pass them the same values.
 */
export interface TranslationDeadKeysOptions
  extends Omit<TranslationKeyExistsOptions, 'catalogs' | 'dynamicKeys'> {
  /** Rule id, for running more than one instance. Default `translation-dead-keys`. */
  readonly id?: string;
  /**
   * The catalogs whose keys must be reachable, in `translation-key-exists`'
   * `CatalogSource` shape. List ONE language (the reference one): a key is dead
   * or alive regardless of how many languages translate it. Empty = inert.
   */
  readonly catalogs?: readonly CatalogSource[];
  /**
   * The namespaces to check. Default: derived from `catalogs`, where a `{ns}`
   * file segment is globbed and a trailing `{ns}` keyPath segment lists the
   * object's keys. Required when a `{ns}` placeholder sits anywhere else.
   */
  readonly namespaces?: readonly string[];
  /** Globs of every file that can reach a key (call sites AND key tables). Empty = inert. */
  readonly sourceGlobs?: readonly string[];
  /** Source paths with any of these segments are skipped. Default `node_modules`, `.git`, `dist`, `.turbo`, `coverage`. */
  readonly skipDirs?: readonly string[];
  /**
   * `ns:key` patterns known to be reached from outside the scanned source
   * (server-sent codes, a CMS, another app). `*` matches any run of characters.
   */
  readonly allow?: readonly string[];
  /** Whether a dead key fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'translation-dead-keys';
const NS_PLACEHOLDER = '{ns}';
/** Everything the TypeScript parser reads; `sourceGlobs` decides which of it is scanned. */
const SOURCE_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts', '**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'];

/** One flattened namespace: its leaf keys and where they came from. */
interface INamespaceKeys {
  readonly namespace: string;
  readonly catalogs: readonly Catalog[];
}

/**
 * Everything the source can reach a key through. `exact` holds namespaced
 * `ns\0key` pairs a translation call names; `prefixes` holds namespaced prefixes
 * (template keys, `returnObjects`); `literals` and `patterns` are namespace-free
 * text harvested from every string in the source, because keys flow as data.
 */
interface IReach {
  readonly exact: Set<string>;
  readonly prefixes: Map<string, string[]>;
  readonly literals: Set<string>;
  readonly patterns: RegExp[];
}

/** `{ns}` in a file path becomes a capture of exactly one path segment. */
function namespacesFromFileTemplate(ctx: IMetaCtx, file: string): string[] {
  const segments = file.split('/');
  if (segments.filter((segment) => segment.includes(NS_PLACEHOLDER)).length !== 1) return [];
  const pattern = file.replaceAll(NS_PLACEHOLDER, '*');
  const capture = new RegExp(
    `^${file.split(NS_PLACEHOLDER).map((part) => escapeRegExp(part).replaceAll('\\*', '[^/]*')).join('([^/]+)')}$`,
    'u',
  );
  const found: string[] = [];
  for (const rel of ctx.glob(pattern)) {
    const namespace = capture.exec(rel)?.[1];
    if (namespace !== undefined) found.push(namespace);
  }
  return found;
}

/** A trailing `{ns}` keyPath segment lists the keys of the object above it. */
function namespacesFromKeyPath(ctx: IMetaCtx, file: string, keyPath: string): string[] | null {
  const segments = keyPath.split('.');
  if (segments.indexOf(NS_PLACEHOLDER) !== segments.length - 1) return null;
  const text = ctx.read(file);
  if (text === null) return [];
  let node: unknown = JSON.parse(text) as unknown;
  for (const segment of segments.slice(0, -1)) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, segment)) return [];
    node = (node as Record<string, unknown>)[segment];
  }
  return node !== null && typeof node === 'object' ? Object.keys(node) : [];
}

/** The namespaces `catalogs` supply, or throws when a placeholder cannot be enumerated. */
export function deriveNamespaces(
  ctx: IMetaCtx,
  catalogs: readonly CatalogSource[],
  defaultNamespace: string,
): string[] {
  const found = new Set<string>();
  for (const source of catalogs) {
    const fileTemplated = source.file.includes(NS_PLACEHOLDER);
    const keyPathTemplated = source.keyPath?.includes(NS_PLACEHOLDER) ?? false;
    if (!fileTemplated && !keyPathTemplated) {
      found.add(source.namespace ?? defaultNamespace);
      continue;
    }
    const derived = fileTemplated
      ? namespacesFromFileTemplate(ctx, source.file)
      : namespacesFromKeyPath(ctx, source.file, source.keyPath ?? '');
    if (derived === null || (fileTemplated && keyPathTemplated)) {
      throw new Error(
        `cannot enumerate the namespaces of catalog ${JSON.stringify(source)}: list them in \`namespaces\``,
      );
    }
    for (const namespace of derived) found.add(namespace);
  }
  return [...found].sort();
}

/** A literal text pattern: fixed fragments with `.*` for each dynamic hole. */
function holePattern(fragments: readonly string[]): RegExp | null {
  // A pattern that is all holes, or whose text is only separators, matches
  // (nearly) every key and is evidence for none of them.
  if (fragments.join('').replace(/[.:_\-/\s]/gu, '').length < 2) return null;
  return new RegExp(`^${fragments.map(escapeRegExp).join('.*')}$`, 'u');
}

/**
 * The text fragments of a `+` chain or template literal, split at every
 * dynamic hole (`'a.' + x + '.b'` and `` `a.${x}.b` `` both give `['a.', '.b']`).
 * `null` when the expression holds no string at all (`a + 1`).
 */
function textFragments(root: TSESTree.Node): string[] | null {
  const fragments = [''];
  let sawText = false;
  const hole = (): void => {
    if (fragments.length === 1 || fragments[fragments.length - 1] !== '') fragments.push('');
  };
  const text = (value: string): void => {
    sawText = true;
    fragments[fragments.length - 1] += value;
  };
  const visit = (node: TSESTree.Node): void => {
    if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
      visit(node.left);
      visit(node.right);
    } else if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
      text(node.value);
    } else if (node.type === AST_NODE_TYPES.TemplateLiteral) {
      node.quasis.forEach((quasi, index) => {
        if (index > 0) hole();
        text(quasi.value.cooked ?? '');
      });
    } else {
      hole();
    }
  };
  visit(root);
  return sawText ? fragments : null;
}

/**
 * Walk every call-site file once with ESLint's own scope analysis, collecting
 * the translation usages `translation-key-exists` sees plus every string the
 * source holds. Returns the files ESLint could not parse: a file it cannot read
 * may reach any key, so the caller must not call anything dead.
 */
function collectReach(
  ctx: IMetaCtx,
  files: readonly string[],
  options: TranslationDeadKeysOptions,
  reach: IReach,
): string[] {
  const settings = translationSettingsOf(options);
  const fallbackNamespaces = options.fallbackNamespaces ?? [];
  const keySeparator = settings.keySeparator;

  const addPrefix = (namespace: string, prefix: string): void => {
    reach.prefixes.set(namespace, [...(reach.prefixes.get(namespace) ?? []), prefix]);
  };
  const onUsage = (usage: TranslationUsage): void => {
    if (usage.kind === 'key') {
      for (const namespace of [...usage.namespaces, ...fallbackNamespaces]) {
        for (const key of usage.keys) {
          reach.exact.add(`${namespace}\0${key}`);
          if (usage.returnObjects && keySeparator !== false) addPrefix(namespace, `${key}${keySeparator}`);
        }
      }
    } else if (usage.kind === 'prefix') {
      for (const namespace of [...usage.namespaces, ...fallbackNamespaces]) addPrefix(namespace, usage.prefix);
    }
    // `dynamic` and `unresolved` name no key; whatever they reach arrives as a
    // string somewhere in the source, which the literal harvest records.
  };

  const addText = (node: TSESTree.Node): void => {
    const fragments = textFragments(node);
    if (fragments === null) return;
    if (fragments.length === 1) {
      if (fragments[0] !== '') reach.literals.add(fragments[0] ?? '');
      return;
    }
    const pattern = holePattern(fragments);
    if (pattern !== null) reach.patterns.push(pattern);
  };

  const collector: TSESLint.RuleModule<'never'> = {
    defaultOptions: [],
    meta: { type: 'problem', schema: [], messages: { never: 'never reported' } },
    create(context) {
      return {
        ...createTranslationVisitor(context, settings, onUsage),
        Literal(node): void {
          if (typeof node.value === 'string' && node.value !== '') reach.literals.add(node.value);
        },
        TemplateLiteral(node): void {
          // A template inside a `+` chain is part of that chain's pattern.
          if (!isConcatOperand(node)) addText(node);
        },
        BinaryExpression(node): void {
          // Only the outermost `+`, so `'a.' + x + '.b'` is one pattern.
          if (node.operator === '+' && !isConcatOperand(node)) addText(node);
        },
      };
    },
  };

  const linter = new Linter({ cwd: ctx.root });
  const config: Linter.Config[] = [
    {
      // Not `**/*`: flat config treats a match-everything pattern as universal
      // and applies it to no file on its own.
      files: SOURCE_FILES,
      languageOptions: {
        parser: tsParser as Linter.Parser,
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      linterOptions: { reportUnusedDisableDirectives: 'off' },
      plugins: { deadKeys: { rules: { collect: collector as unknown as Rule.RuleModule } } },
      rules: { 'deadKeys/collect': 'error' },
    },
  ];

  const unparsed: string[] = [];
  for (const file of files) {
    const text = ctx.read(file);
    if (text === null) continue;
    const messages = linter.verify(text, config, { filename: path.join(ctx.root, file) });
    // A parse error, or a file no config applies to (`ruleId: null` either way),
    // means the visitor never saw it.
    if (messages.some((message) => message.ruleId === null)) unparsed.push(file);
  }
  return unparsed;
}

/** Is `node` an operand of a `+` (so the enclosing chain owns its text)? */
function isConcatOperand(node: TSESTree.Node): boolean {
  const parent = node.parent;
  return parent?.type === AST_NODE_TYPES.BinaryExpression && parent.operator === '+';
}

/** `*` globs over `ns:key` as anchored regexes. */
function allowPatterns(allow: readonly string[]): RegExp[] {
  return allow.map((pattern) => new RegExp(`^${pattern.split('*').map(escapeRegExp).join('.*')}$`, 'u'));
}

/**
 * The key and each plural / context base of it: i18next names those forms by
 * appending `_suffix` to the last segment (`key_one`, `key_ordinal_few`,
 * `key_male`), so a source that reaches `key` may reach any of them.
 */
function lookupForms(key: string, keySeparator: string | false): string[] {
  const forms = [key];
  const lastSegmentStart = keySeparator === false ? 0 : key.lastIndexOf(keySeparator) + 1;
  let base = key;
  while (base.lastIndexOf('_') > lastSegmentStart) {
    base = base.slice(0, base.lastIndexOf('_'));
    forms.push(base);
  }
  return forms;
}

/** Is `key` in `namespace` reached by anything the source holds? */
function isReached(
  namespace: string,
  key: string,
  reach: IReach,
  nsSeparator: string | false,
  keySeparator: string | false,
): boolean {
  for (const prefix of reach.prefixes.get(namespace) ?? []) {
    if (key.startsWith(prefix)) return true;
  }
  const texts: string[] = [];
  for (const form of lookupForms(key, keySeparator)) {
    if (reach.exact.has(`${namespace}\0${form}`)) return true;
    texts.push(form);
    if (nsSeparator !== false) texts.push(`${namespace}${nsSeparator}${form}`);
  }
  if (texts.some((text) => reach.literals.has(text))) return true;
  return reach.patterns.some((pattern) => texts.some((text) => pattern.test(text)));
}

/**
 * Catalog keys nothing in the source can reach. A whole-program check, so it
 * lives here and not in ESLint: a per-file rule never sees every call site, and
 * keys flow as data (key tables, helper functions, server codes), which a
 * call-site-only analysis cannot follow.
 *
 * CONSERVATIVE BY DESIGN. A key counts as reached when ANY of these holds:
 *   - a translation call resolves to it (same visitor as `translation-key-exists`),
 *   - a template key's static head is a prefix of it (`` t(`status.${s}`) ``),
 *   - any string literal in the source equals it, `ns:key`, an ancestor of it,
 *     or its plural/context base (`key` for `key_one`),
 *   - any template literal or `+` chain in the source can produce it,
 *   - it matches an `allow` pattern.
 * And it reports NOTHING when a source file cannot be parsed. What is left was
 * named by no call and spelled by no string: dead, or reached from outside the
 * scanned source (see the rule doc's blind spots).
 */
export function createTranslationDeadKeysRule(options: TranslationDeadKeysOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const catalogs = options.catalogs ?? [];
  const sourceGlobs = options.sourceGlobs ?? [];
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const allow = allowPatterns(options.allow ?? []);
  const ciCritical = options.ciCritical ?? true;
  const defaultNamespace = options.defaultNamespace ?? TRANSLATION_DEFAULTS.defaultNamespace;
  const nsSeparator = options.nsSeparator ?? TRANSLATION_DEFAULTS.nsSeparator;
  const keySeparator = options.keySeparator ?? TRANSLATION_DEFAULTS.keySeparator;

  return {
    id,
    category: 'source-text',
    ciCritical,
    description:
      'Every translation catalog key must be reachable from the source: named by a translation call, or spelled by some string in the code.',
    run(ctx) {
      if (catalogs.length === 0 || sourceGlobs.length === 0) return [];

      const violations: IViolation[] = [];
      const report = (file: string, message: string): void => {
        violations.push({ file, rule: id, message });
      };

      const namespaces = options.namespaces ?? deriveNamespaces(ctx, catalogs, defaultNamespace);
      const keyed: INamespaceKeys[] = [];
      for (const namespace of namespaces) {
        const loaded = catalogsForNamespace(namespace, catalogs, {
          cwd: ctx.root,
          defaultNamespace,
          keySeparator,
        });
        for (const reason of loaded.errors) report(reason.split(':')[0] ?? reason, `Catalog could not be loaded: ${reason}.`);
        keyed.push({ namespace, catalogs: loaded.catalogs });
      }
      if (violations.length > 0) return violations;

      const reach: IReach = { exact: new Set(), prefixes: new Map(), literals: new Set(), patterns: [] };
      const files = globFiles((pattern) => ctx.glob(pattern), sourceGlobs, skipDirs);
      if (files.length === 0) {
        report(sourceGlobs.join(', '), 'No source file matches `sourceGlobs`, so every key would look dead. Fix the globs.');
        return violations;
      }
      const unparsed = collectReach(ctx, files, options, reach);
      if (unparsed.length > 0) {
        for (const file of unparsed) {
          report(file, 'Could not analyse this file (a parse error, or not a JS/TS file), so the keys it reaches are unknown. Dead-key analysis is skipped until every source file is analysable.');
        }
        return violations;
      }

      for (const { namespace, catalogs: sources } of keyed) {
        for (const catalog of sources) {
          for (const key of [...catalog.leaves].sort()) {
            if (isReached(namespace, key, reach, nsSeparator, keySeparator)) continue;
            const qualified = `${namespace}:${key}`;
            if (allow.some((pattern) => pattern.test(qualified))) continue;
            report(
              catalog.label.split('#')[0] ?? catalog.label,
              `Translation key \`${qualified}\` (${catalog.label}) is named by no translation call and spelled by no string in the source. Delete it, or add it to \`allow\` if it is reached from outside the scanned files.`,
            );
          }
        }
      }
      return violations;
    },
  };
}
