import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  type Catalog,
  type CatalogSource,
  catalogHasKey,
  catalogHasPrefix,
  catalogsForNamespace,
  type NamespaceCatalogs,
} from '../i18n/catalogs';
import { createTranslationVisitor, type TranslationSettings } from '../i18n/translationUsage';

const RULE_NAME = 'translation-key-exists';

export interface TranslationKeyExistsOptions {
  /** Where each namespace's catalog lives. Empty = rule is inert. */
  readonly catalogs?: readonly CatalogSource[];
  /** The namespace an unqualified `useTranslation()` / `i18n.t` resolves to (i18next `defaultNS`). */
  readonly defaultNamespace?: string;
  /** Namespaces searched after the bound ones (i18next `fallbackNS`). */
  readonly fallbackNamespaces?: readonly string[];
  /** Hooks returning a namespace-bound `t` (`useTranslation`). */
  readonly hooks?: readonly string[];
  /** i18next instance identifiers: `<instance>.t(...)`, `<instance>.getFixedT(...)`. */
  readonly instances?: readonly string[];
  /** Free translation functions bound to the default namespace when imported or global (`t`). */
  readonly functions?: readonly string[];
  /** Type names whose first type argument names a parameter's namespace (`TFunction<'ns'>`). */
  readonly typeNames?: readonly string[];
  /** JSX components taking an `i18nKey` prop (`Trans`). */
  readonly transComponents?: readonly string[];
  /** Identifiers holding a namespace name that live in another module (`{ HELP_NS: 'help' }`). */
  readonly namespaceIdentifiers?: Readonly<Record<string, string>>;
  /** i18next `nsSeparator`; `false` disables `ns:key` parsing. */
  readonly nsSeparator?: string | false;
  /** i18next `keySeparator`; `false` means flat catalogs. */
  readonly keySeparator?: string | false;
  /** i18next `pluralSeparator`. */
  readonly pluralSeparator?: string;
  /** i18next `contextSeparator`. */
  readonly contextSeparator?: string;
  /** `ignore` stays silent on template keys; `check-prefix` requires their static head to exist. */
  readonly dynamicKeys?: 'ignore' | 'check-prefix';
}

type RuleOptions = [TranslationKeyExistsOptions];
type MessageIds = 'missingKey' | 'missingKeyPrefix' | 'unknownNamespace' | 'catalogUnreadable';

const stringList: JSONSchema4 = { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true };
const separator: JSONSchema4 = { oneOf: [{ type: 'string', minLength: 1 }, { type: 'boolean', enum: [false] }] };

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    catalogs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['file'],
        properties: {
          file: { type: 'string', minLength: 1 },
          namespace: { type: 'string', minLength: 1 },
          keyPath: { type: 'string', minLength: 1 },
        },
      },
    },
    defaultNamespace: { type: 'string', minLength: 1 },
    fallbackNamespaces: stringList,
    hooks: stringList,
    instances: stringList,
    functions: stringList,
    typeNames: stringList,
    transComponents: stringList,
    namespaceIdentifiers: { type: 'object', additionalProperties: { type: 'string', minLength: 1 } },
    nsSeparator: separator,
    keySeparator: separator,
    pluralSeparator: { type: 'string', minLength: 1 },
    contextSeparator: { type: 'string', minLength: 1 },
    dynamicKeys: { type: 'string', enum: ['ignore', 'check-prefix'] },
  },
};

/** Defaults mirror i18next / react-i18next's own. */
export const TRANSLATION_DEFAULTS = {
  defaultNamespace: 'translation',
  hooks: ['useTranslation'],
  instances: ['i18n', 'i18next'],
  functions: ['t'],
  typeNames: ['TFunction'],
  transComponents: ['Trans'],
  nsSeparator: ':',
  keySeparator: '.',
  pluralSeparator: '_',
  contextSeparator: '_',
} as const;

/** Normalise user options into the visitor's settings. */
export function translationSettingsOf(options: TranslationKeyExistsOptions): TranslationSettings {
  return {
    hooks: new Set(options.hooks ?? TRANSLATION_DEFAULTS.hooks),
    instances: new Set(options.instances ?? TRANSLATION_DEFAULTS.instances),
    functions: new Set(options.functions ?? TRANSLATION_DEFAULTS.functions),
    typeNames: new Set(options.typeNames ?? TRANSLATION_DEFAULTS.typeNames),
    transComponents: new Set(options.transComponents ?? TRANSLATION_DEFAULTS.transComponents),
    namespaceIdentifiers: options.namespaceIdentifiers ?? {},
    defaultNamespace: options.defaultNamespace ?? TRANSLATION_DEFAULTS.defaultNamespace,
    nsSeparator: options.nsSeparator ?? TRANSLATION_DEFAULTS.nsSeparator,
    keySeparator: options.keySeparator ?? TRANSLATION_DEFAULTS.keySeparator,
  };
}

/*
 * A static `t('some.key')` whose key is in no catalog renders the raw key at
 * runtime, and nothing at build time says so: a renamed or deleted catalog key
 * is a silent UI regression. This rule resolves every static key against the
 * catalog of the namespace in scope, i18next-style.
 *
 * INERT UNTIL CONFIGURED: with no `catalogs` the rule reports nothing. There is
 * no built-in catalog location; the project says where each namespace lives.
 *
 * NEVER GUESSES: a key it cannot resolve statically (a variable, a template, a
 * namespace held in an unresolvable identifier, an opaque options bag) is left
 * alone. `dynamicKeys: 'check-prefix'` opts in to checking a template key's
 * static head, which is sound (no catalog key can match a head nothing starts
 * with) but still silent on the dynamic tail.
 *
 * Plural (`key_one`, `key_ordinal_few`) and context (`key_male`) variants count
 * only when the call passes `count` / `context`, because without them i18next
 * looks up the bare key and misses. `returnObjects` lets a subtree answer.
 *
 * Dead keys (catalog keys nothing reaches) are NOT this rule's job: that needs
 * every source file at once, which a per-file ESLint rule never has soundly.
 */
export const translationKeyExistsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require every static i18next / react-i18next translation key (`t(...)`, `i18n.t(...)`, `<Trans i18nKey>`) to exist in the catalog of the namespace in scope.',
    },
    schema: [optionSchema],
    messages: {
      missingKey:
        'Translation key `{{key}}` does not exist in namespace `{{namespace}}` ({{catalogs}}). It renders as the raw key at runtime: fix the key or add it to the catalog.',
      missingKeyPrefix:
        'No key in namespace `{{namespace}}` ({{catalogs}}) starts with `{{prefix}}`, so this template key can never resolve.',
      unknownNamespace:
        'Namespace `{{namespace}}` has no catalog in the rule configuration. Fix the namespace name or add a `catalogs` entry for it.',
      catalogUnreadable: 'Translation catalog could not be loaded: {{reason}}.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const sources = options.catalogs ?? [];
    if (sources.length === 0) {
      return {};
    }
    const settings = translationSettingsOf(options);
    const fallbackNamespaces = options.fallbackNamespaces ?? [];
    const catalogSettings = {
      cwd: context.cwd,
      defaultNamespace: settings.defaultNamespace,
      keySeparator: settings.keySeparator,
    };
    const lookupBase = {
      pluralSeparator: options.pluralSeparator ?? TRANSLATION_DEFAULTS.pluralSeparator,
      contextSeparator: options.contextSeparator ?? TRANSLATION_DEFAULTS.contextSeparator,
    };
    const checkPrefix = options.dynamicKeys === 'check-prefix';

    // Per-file memo; the file cache underneath is process-wide.
    const resolved = new Map<string, NamespaceCatalogs>();
    const reportedErrors = new Set<string>();
    function catalogsOf(namespace: string): NamespaceCatalogs {
      let entry = resolved.get(namespace);
      if (entry === undefined) {
        entry = catalogsForNamespace(namespace, sources, catalogSettings);
        resolved.set(namespace, entry);
      }
      return entry;
    }

    /**
     * Gather the catalogs a call searches. Returns null (and reports) when the
     * configuration itself is broken, so a bad catalog path is loud, once per
     * file, instead of turning into a wall of missing-key errors.
     */
    function searched(node: TSESTree.Node, namespaces: readonly string[]): readonly Catalog[] | null {
      const catalogs: Catalog[] = [];
      for (const namespace of [...namespaces, ...fallbackNamespaces]) {
        const entry = catalogsOf(namespace);
        for (const reason of entry.errors) {
          if (!reportedErrors.has(reason)) {
            reportedErrors.add(reason);
            context.report({ node, messageId: 'catalogUnreadable', data: { reason } });
          }
        }
        if (entry.errors.length > 0) return null;
        catalogs.push(...entry.catalogs);
      }
      if (catalogs.length === 0) {
        context.report({ node, messageId: 'unknownNamespace', data: { namespace: namespaces.join('`, `') } });
        return null;
      }
      return catalogs;
    }

    const labels = (catalogs: readonly Catalog[]): string => catalogs.map((catalog) => catalog.label).join(', ');

    return createTranslationVisitor(context, settings, (usage) => {
      if (usage.kind === 'key') {
        const catalogs = searched(usage.node, usage.namespaces);
        if (catalogs === null) return;
        const lookup = { ...lookupBase, plural: usage.plural, context: usage.context, returnObjects: usage.returnObjects };
        const found = usage.keys.some((key) => catalogs.some((catalog) => catalogHasKey(catalog, key, lookup)));
        if (!found) {
          context.report({
            node: usage.node,
            messageId: 'missingKey',
            data: { key: usage.keys.join('` | `'), namespace: usage.namespaces.join('`, `'), catalogs: labels(catalogs) },
          });
        }
        return;
      }
      if (usage.kind === 'prefix' && checkPrefix) {
        const catalogs = searched(usage.node, usage.namespaces);
        if (catalogs === null) return;
        if (!catalogs.some((catalog) => catalogHasPrefix(catalog, usage.prefix))) {
          context.report({
            node: usage.node,
            messageId: 'missingKeyPrefix',
            data: { prefix: usage.prefix, namespace: usage.namespaces.join('`, `'), catalogs: labels(catalogs) },
          });
        }
      }
    });
  },
});
