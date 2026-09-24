# `translation-dead-keys`

> Every translation catalog key is reachable from the source: named by a translation call, or spelled
> by some string in the code.

<!-- begin generated rule header -->
Runs under `@noctcore/harness`, not ESLint · Factory `createTranslationDeadKeysRule` from `@noctcore/lint-meta-rules/i18n` · Category `source-text` · Fails CI by default: yes
<!-- end generated rule header -->

Import it from the `i18n` entry point, which (unlike the main one) loads ESLint:

```ts
import { createTranslationDeadKeysRule } from '@noctcore/lint-meta-rules/i18n';
```

## Why

A catalog key nothing uses is still translated, reviewed and shipped in every language. Finding them is
a whole-program question, so it is not an ESLint rule: a per-file rule never sees every call site
(editor runs, `--cache`, lint-staged, sharded workers), and keys flow as data (key tables, key-building
helpers, server-sent codes) that no call-site analysis follows.

This rule resolves call sites with the same visitor and catalog loader as
`noctcore-contracts/translation-key-exists` (exported by `@noctcore/eslint-plugin-contracts`), so the
two checks never disagree on which key a call means. It then adds the data routes a per-file rule
cannot see.

## What counts as reached

A key is reached, and never reported, when ANY of these holds:

- a translation call resolves to it: `t('key')`, `t('ns:key')`, `t('key', { ns })`,
  `useTranslation('ns', { keyPrefix })`, `<Trans i18nKey>`, a `TFunction<'ns'>` parameter, the
  `fallbackNamespaces`;
- a template key's static head is a prefix of it: `` t(`status.${s}`) `` reaches every `status.*`;
- a `returnObjects` call names one of its ancestors;
- ANY string literal in the scanned source equals the key, `ns:key`, or its plural/context base
  (`key` reaches `key_one`, `key_ordinal_few`, `key_male`), in any namespace;
- ANY template literal or `+` chain in the scanned source can produce it:
  `` `nav.${id}.label` `` and `'errors.' + code` are patterns, not just call arguments;
- it matches an `allow` pattern.

And it reports **no dead key at all** when a scanned file cannot be analysed (a parse error), or when
`sourceGlobs` match nothing: in both cases the rule would otherwise call reached keys dead.

What is left was named by no call and spelled by no string. On a production app with 1,824 keys this
reported 55, and every one of them had zero references outside the catalogs.

## Blind spots

It is conservative, not complete. It reports a reached key as dead when the key arrives by a route it
cannot see:

- **Keys that never appear in the scanned source**: server-sent codes, a CMS, another app, JSON
  config. List them in `allow`, or add the files that spell them to `sourceGlobs`.
- **A variable key under a `keyPrefix` binding**: `useTranslation('ns', { keyPrefix: 'form' })` then
  `t(field)` with `field = 'name'` reaches `form.name`, but no string spells `form.name`. (A static key
  under a `keyPrefix` is resolved correctly.)
- **Keys built by anything other than `+` or a template literal**: `[a, b].join('.')`,
  `` `${a}` `` split across variables, `String.prototype.concat`.

It also misses some dead keys, by design: any string that happens to equal a key (in any namespace)
keeps it alive, and a broad pattern such as `` `${x}.title` `` keeps every `*.title` alive.

## Factory

```ts
createTranslationDeadKeysRule(options?: TranslationDeadKeysOptions): IMetaRule
```

Inert until both `catalogs` and `sourceGlobs` are set; there are no built-in paths.

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `catalogs` | `CatalogSource[]` | `[]` | The catalogs to check, in `translation-key-exists`' shape (`{ file, namespace?, keyPath? }`, `{ns}` placeholders allowed). List ONE language: a key is dead or alive regardless of how many languages translate it. |
| `sourceGlobs` | `string[]` | `[]` | Every file that can reach a key: call sites AND key tables. Include tests if a key used only by a test should count as alive. |
| `namespaces` | `string[]` | derived | The namespaces to check. Derived from `catalogs`: a `{ns}` file segment is globbed, a trailing `{ns}` keyPath segment lists the object's keys. Required when a `{ns}` sits anywhere else. |
| `allow` | `string[]` | `[]` | `ns:key` patterns reached from outside the scanned source; `*` matches any run of characters. |
| `skipDirs` | `string[]` | `['node_modules', '.git', 'dist', '.turbo', 'coverage']` | Source paths with any of these segments are skipped. |
| `id` | `string` | `'translation-dead-keys'` | Rule id, for running more than one instance. |
| `ciCritical` | `boolean` | `true` | Whether a dead key fails CI. |

Every resolution option of `translation-key-exists` is accepted and means the same thing:
`defaultNamespace`, `fallbackNamespaces`, `hooks`, `instances`, `functions`, `typeNames`,
`transComponents`, `namespaceIdentifiers`, `nsSeparator`, `keySeparator`. Pass them the same values.

```ts
createTranslationDeadKeysRule({
  catalogs: [
    { file: 'apps/web/src/lib/i18n/locales/pl.json', keyPath: '{ns}' },
    { file: 'apps/web/src/features/{ns}/locales/pl.json' },
  ],
  defaultNamespace: 'common',
  namespaceIdentifiers: { HELP_NS: 'help' },
  sourceGlobs: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
});
```

## Requirements

The `i18n` entry needs the optional peers `eslint` (>= 9) and `@typescript-eslint/parser`. Scanned
files are parsed as TypeScript with JSX enabled, without type information.
