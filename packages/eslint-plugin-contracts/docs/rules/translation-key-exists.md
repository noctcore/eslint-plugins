# `noctcore-contracts/translation-key-exists`

> Every static translation key must exist in the catalog of the namespace in scope.

<!-- begin generated rule header -->
⚙️ Opt-in: `off` in `recommended`; needs options (see Options) · 💭 Type information: used when available
<!-- end generated rule header -->

## Why

i18next does not fail on a missing key. It renders the key itself (`admin.portalAccounts.revokeTitle`)
or silently falls back to another language, and nothing at build time says so. A renamed or deleted
catalog key, a typo, or a key looked up in the wrong namespace is a UI regression that only a human
reading the screen will catch. This rule resolves every static key the way i18next would and reports
the ones that cannot resolve.

## What it flags

A static key that no configured catalog of the namespace in scope contains:

```tsx prose reason="the rule reads the translation catalogs named in its options from disk"
// catalogs: common = { actions: { save, cancel } }, portal = { tasks: { title } }

const { t } = useTranslation(); // default namespace: common
t('actions.sav'); // ✗ typo
t('common.cancel'); // ✗ the namespace is not a key segment; this renders "common.cancel"
t('actions.save'); // ✓

const { t: tp } = useTranslation('portal');
tp('actions.save'); // ✗ exists, but in `common`, not `portal`
tp('common:actions.save'); // ✓ explicit namespace
tp('actions.save', { ns: 'common' }); // ✓ explicit namespace
```

It also reports a namespace that has no catalog at all (`useTranslation('portl')`), and a catalog
that exists but cannot be parsed, once per file.

### Where namespaces come from

The rule reads them from syntax, per file, in the shapes i18next and react-i18next document:

| Shape | Namespace(s) searched |
| --- | --- |
| `const { t } = useTranslation('ns')`, also `[t]`, `{ t: alias }`, `r.t` | `ns` |
| `useTranslation(['a', 'b'])` | `a`, then `b` |
| `useTranslation('ns', { keyPrefix: 'p' })` | `ns`, key prefixed with `p.` |
| `const t = i18n.getFixedT(lng, 'ns', 'p')` | `ns`, key prefixed with `p.` |
| `i18n.t(...)`, `i18next.t(...)`, an imported or global `t` | the default namespace |
| `function f(t: TFunction<'ns'>)` | `ns` |
| `t('ns:key')` | `ns` (wins over everything) |
| `t('key', { ns: 'ns' })` | `ns` (wins over the binding) |
| `<Trans i18nKey="key" ns="ns" t={t} />` | `ns`, else the bound `t`, else the default |

A namespace argument may be a string literal, an array of literals, a same-file `const`, a name in
`namespaceIdentifiers`, or, under typed linting, any identifier whose type is one string literal.

### Plurals, context, objects

Plural forms (`key_one`, `key_few`, `key_ordinal_other`) answer for `key` only when the call passes
`count`, and context variants (`key_male`) only when it passes `context`, because without them
i18next looks up the bare key and misses. A subtree or array answers only with `returnObjects`.

### What it never reports

Anything it cannot resolve statically: a variable key (`t(someKey)`), a template key
(`` t(`status.${s}`) ``), a key computed by a helper, a namespace held in an identifier it cannot
resolve (an import not listed in `namespaceIdentifiers`), an options bag it cannot read
(`t('k', opts)`, `{ ...opts }`, `{ ns: someNs }`), and a `t` parameter with no `TFunction` type. The
rule stays silent on those rather than guessing.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `catalogs` | `{ file, namespace?, keyPath? }[]` | `[]` | Where each namespace's keys live. Empty = rule is inert. See below. |
| `defaultNamespace` | `string` | `'translation'` | i18next `defaultNS`: what `useTranslation()` and `i18n.t` resolve to. |
| `fallbackNamespaces` | `string[]` | `[]` | i18next `fallbackNS`: searched after the bound namespaces. |
| `hooks` | `string[]` | `['useTranslation']` | Hooks returning a namespace-bound `t`. |
| `instances` | `string[]` | `['i18n', 'i18next']` | i18next instances: `<instance>.t(...)`, `<instance>.getFixedT(...)`. |
| `functions` | `string[]` | `['t']` | Bare translation functions bound to the default namespace when imported (by that name) or global. An untyped parameter with one of these names is skipped. |
| `typeNames` | `string[]` | `['TFunction']` | Parameter types whose first type argument is the namespace, second the key prefix. |
| `transComponents` | `string[]` | `['Trans']` | JSX components taking `i18nKey` / `ns` / `t` / `count` / `context` props. |
| `namespaceIdentifiers` | `Record<string, string>` | `{}` | Imported identifiers that hold a namespace name, e.g. `{ HELP_NS: 'help' }`. |
| `nsSeparator` | `string \| false` | `':'` | i18next `nsSeparator`. `false` turns off `ns:key` parsing. |
| `keySeparator` | `string \| false` | `'.'` | i18next `keySeparator`. `false` means flat catalogs. |
| `pluralSeparator` | `string` | `'_'` | i18next `pluralSeparator`. |
| `contextSeparator` | `string` | `'_'` | i18next `contextSeparator`. |
| `dynamicKeys` | `'ignore' \| 'check-prefix'` | `'ignore'` | `check-prefix` also requires a template key's static head (`` `status.${s}` `` → `status.`) to be the start of at least one key. Sound, since nothing else can match, but opt-in. |

Relative paths resolve against the ESLint working directory. Match the separators and default
namespace to your `i18next.init` options.

### `catalogs`

Each entry is a JSON file, or a subtree of one, holding a namespace's keys. Use the one reference
language whose keys are the source of truth (catalog parity between languages is a different check).

| Layout | Entry |
| --- | --- |
| one file per namespace | `{ file: 'public/locales/en/{ns}.json' }` |
| one file, namespaces at the top level | `{ file: 'src/i18n/en.json', keyPath: '{ns}' }` |
| a fixed file for one namespace | `{ file: 'src/i18n/common.en.json', namespace: 'common' }` |
| single-namespace app | `{ file: 'src/i18n/en.json' }` (supplies `defaultNamespace`) |

`{ns}` is replaced by the namespace being resolved, in `file` and in `keyPath` (a dot path). A
templated entry whose file or subtree does not exist simply does not supply that namespace; a fixed
entry that cannot be read is reported. Entries are unioned, so several may supply one namespace.
Catalogs are read on demand, cached for the process, and re-read when their modification time
changes. A namespace that would escape its directory (`..`, a path separator) is never substituted.

### Worked example

A Polish-first React app with two shared namespaces (`common`, `errors`) stored as the top-level
keys of `apps/web/src/lib/i18n/locales/pl.json`, one namespace per feature at
`apps/web/src/features/<ns>/locales/pl.json`, `defaultNS: 'common'`, and one namespace name
exported as a constant from another module:

```js
import contracts from '@noctcore/eslint-plugin-contracts';

export default [
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'noctcore-contracts': contracts },
    rules: {
      'noctcore-contracts/translation-key-exists': [
        'error',
        {
          catalogs: [
            { file: 'apps/web/src/lib/i18n/locales/pl.json', keyPath: '{ns}' },
            { file: 'apps/web/src/features/{ns}/locales/pl.json' },
          ],
          defaultNamespace: 'common',
          namespaceIdentifiers: { HELP_NS: 'help' },
        },
      ],
    },
  },
];
```

With that configuration the rule resolved 1,500 static keys across 1,110 files of that app and
found one real bug (`t('common.cancel')` in the default namespace, which renders the raw key). A
namespace registered at runtime only inside a test (`registerFeatureNamespace('late-arrival', ...)`)
is reported as unknown; exclude test files or add a catalog entry for it.

## Dead keys are out of scope

The reverse check, "a catalog key nothing uses", is not something a per-file ESLint rule can do
soundly: it needs every source file at once, and ESLint may lint one file (editor), a subset
(`--cache`, lint-staged), or shard files across workers. Worse, keys routinely flow as data
(navigation tables, key-builder helpers, `` `errors:${code}` ``), which no call-site analysis
sees. Run it as a whole-tree check instead, one that unions static keys, template-key prefixes
and string literals that equal a key.

## When not to use it

If your keys are mostly computed, or your catalogs are not JSON files on disk (fetched from a TMS at
runtime, generated at build time), leave this rule off.
