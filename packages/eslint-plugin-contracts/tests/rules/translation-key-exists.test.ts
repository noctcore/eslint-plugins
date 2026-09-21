import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ruleTester } from '@noctcore/eslint-test-utils';
import { afterAll, describe, expect, it } from 'vitest';

import { catalogsForNamespace } from '../../src/i18n/catalogs';
import { translationKeyExistsRule } from '../../src/rules/translation-key-exists';

const FILE = 'src/feature.tsx';

// Real catalogs on disk: the rule reads the filesystem, so a fake would prove nothing.
const FIXTURES = fileURLToPath(new URL('../fixtures/i18n/', import.meta.url));
const SHARED = path.join(FIXTURES, 'shared.json');

// The layout the docs use as the worked example: shared namespaces as the top-level
// keys of one file, and one file per feature namespace.
const base = {
  catalogs: [{ file: SHARED, keyPath: '{ns}' }, { file: path.join(FIXTURES, 'features/{ns}/locales/pl.json') }],
  defaultNamespace: 'common',
};
const options = [base] as const;

ruleTester.run('translation-key-exists', translationKeyExistsRule, {
  valid: [
    // Default namespace through the hook.
    { code: `const { t } = useTranslation(); t('actions.save');`, filename: FILE, options },
    // Namespace from the hook argument.
    { code: `const { t } = useTranslation('portal'); t('tasks.title');`, filename: FILE, options },
    // Namespace array: every listed namespace is searched, in order.
    { code: `const { t } = useTranslation(['portal', 'common']); t('actions.save');`, filename: FILE, options },
    // Array destructuring, aliasing and the hook result object.
    { code: `const [t] = useTranslation('portal'); t('tasks.empty');`, filename: FILE, options },
    { code: `const { t: tp } = useTranslation('portal'); tp('tasks.title');`, filename: FILE, options },
    { code: `const r = useTranslation('portal'); r.t('tasks.title');`, filename: FILE, options },
    { code: `const { t } = useTranslation('portal'); const say = t; say('tasks.title');`, filename: FILE, options },
    // keyPrefix on the hook.
    { code: `const { t } = useTranslation('portal', { keyPrefix: 'shell.nav' }); t('tasks');`, filename: FILE, options },
    // Explicit `ns:` head and `{ ns }` option override the binding.
    { code: `const { t } = useTranslation('portal'); t('common:actions.cancel');`, filename: FILE, options },
    { code: `const { t } = useTranslation('portal'); t('actions.cancel', { ns: 'common' });`, filename: FILE, options },
    // Instances, getFixedT, and a typed parameter.
    { code: `i18n.t('errors:NOT_FOUND');`, filename: FILE, options },
    { code: `i18next.t('actions.save');`, filename: FILE, options },
    { code: `const t = i18n.getFixedT(null, 'portal', 'shell'); t('nav.tasks');`, filename: FILE, options },
    { code: `function row(t: TFunction<'portal'>) { return t('tasks.title'); }`, filename: FILE, options },
    { code: `function row(t: TFunction<['portal', 'common']>) { return t('actions.save'); }`, filename: FILE, options },
    // Namespace held in a same-file const, or mapped by option for an imported one.
    { code: `const NS = 'portal'; const { t } = useTranslation(NS); t('tasks.title');`, filename: FILE, options },
    {
      code: `import { PORTAL_NS } from './ns'; const { t } = useTranslation(PORTAL_NS); t('tasks.title');`,
      filename: FILE,
      options: [{ ...base, namespaceIdentifiers: { PORTAL_NS: 'portal' } }],
    },
    // Plurals (incl. ordinal) and context resolve only when the call carries count / context.
    { code: `const { t } = useTranslation(); t('items', { count: 2 });`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t('place', { count: 2, ordinal: true });`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t('friend', { context: gender });`, filename: FILE, options },
    // returnObjects lets a subtree (or an array) answer.
    { code: `const { t } = useTranslation(); t('weekdays', { returnObjects: true });`, filename: FILE, options },
    // Array indices are addressable keys.
    { code: `const { t } = useTranslation(); t('weekdays.0');`, filename: FILE, options },
    // Fallback keys: one resolving is enough.
    { code: `const { t } = useTranslation(); t(['actions.nope', 'actions.save']);`, filename: FILE, options },
    // Legacy `t(key, defaultValue, options)` signature.
    { code: `const { t } = useTranslation(); t('items', 'items', { count });`, filename: FILE, options },
    // fallbackNamespaces are searched after the bound namespace.
    {
      code: `const { t } = useTranslation('portal'); t('actions.save');`,
      filename: FILE,
      options: [{ ...base, fallbackNamespaces: ['common'] }],
    },
    // <Trans>: default namespace, `ns` prop, and a bound `t`.
    { code: `<Trans i18nKey="actions.save" />;`, filename: FILE, options },
    { code: `<Trans i18nKey="tasks.title" ns="portal" />;`, filename: FILE, options },
    { code: `const { t } = useTranslation('portal'); <Trans i18nKey="tasks.title" t={t} />;`, filename: FILE, options },
    { code: `<Trans i18nKey="items" count={n} />;`, filename: FILE, options },
    // Dynamic keys are never reported.
    { code: `const { t } = useTranslation(); t(someKey);`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t(\`status.\${s}\`);`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t(\`nope.\${s}\`);`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t(cond ? 'a' : 'b');`, filename: FILE, options },
    { code: `<Trans i18nKey={key} />;`, filename: FILE, options },
    // ...and neither is anything whose namespace or options are opaque.
    { code: `const { t } = useTranslation(ns); t('whatever');`, filename: FILE, options },
    { code: `import { HELP_NS } from './ns'; const { t } = useTranslation(HELP_NS); t('whatever');`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t('whatever', opts);`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t('whatever', { ...opts });`, filename: FILE, options },
    { code: `const { t } = useTranslation(); t('whatever', { ns: someNs });`, filename: FILE, options },
    { code: `const { t } = useTranslation('portal', { keyPrefix: p }); t('whatever');`, filename: FILE, options },
    { code: `const { t } = useTranslation('portal', { keyPrefix: 'shell' }); t('common:x');`, filename: FILE, options },
    { code: `function f(t: (k: string) => string) { return t('whatever'); }`, filename: FILE, options },
    { code: `function f(t) { return t('whatever'); }`, filename: FILE, options },
    { code: `function f(t: TFunction<Ns>) { return t('whatever'); }`, filename: FILE, options },
    { code: `<Trans i18nKey="whatever" {...props} />;`, filename: FILE, options },
    // Not translation functions at all.
    { code: `const t = makeThing(); t('whatever');`, filename: FILE, options },
    { code: `import { t } from 'i18next'; foo.t('whatever');`, filename: FILE, options },
    { code: `const { format: t } = useTranslation(); t('whatever');`, filename: FILE, options },
    { code: `const t = useTranslation(); t('whatever');`, filename: FILE, options },
    // Callee sets are options: an empty `functions` stops treating a bare `t` as one.
    { code: `t('whatever');`, filename: FILE, options: [{ ...base, functions: [] }] },
    // Inert with no catalogs configured.
    { code: `const { t } = useTranslation(); t('whatever');`, filename: FILE, options: [{}] },
    // Single-namespace project: a fixed file with no namespace supplies the default one.
    {
      code: `const { t } = useTranslation(); t('menu.open'); t('hello');`,
      filename: FILE,
      options: [{ catalogs: [{ file: path.join(FIXTURES, 'translation.json') }] }],
    },
    // Flat catalogs (keySeparator: false) and natural-language keys (nsSeparator: false).
    {
      code: `const { t } = useTranslation(); t('Welcome back.'); t('menu.open');`,
      filename: FILE,
      options: [{ catalogs: [{ file: path.join(FIXTURES, 'flat.json') }], keySeparator: false, nsSeparator: false }],
    },
    // A template head that exists passes check-prefix.
    {
      code: `const { t } = useTranslation(); t(\`status.\${s}\`); i18n.t(\`errors:\${code}\`);`,
      filename: FILE,
      options: [{ ...base, dynamicKeys: 'check-prefix' }],
    },
  ],
  invalid: [
    // A typo in the default namespace.
    {
      code: `const { t } = useTranslation(); t('actions.sav');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey', data: { key: 'actions.sav', namespace: 'common', catalogs: `${SHARED}#common` } }],
    },
    // The key exists, but in another namespace than the one in scope.
    {
      code: `const { t } = useTranslation('portal'); t('actions.save');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey' }],
    },
    // Repeating the namespace as a key segment (a real Settly bug: `t('common.cancel')`).
    {
      code: `const { t } = useTranslation(); t('common.cancel');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey' }],
    },
    // Every binding shape is checked.
    {
      code: [
        `const { t: tp } = useTranslation('portal'); tp('tasks.nope');`,
        `const r = useTranslation('portal'); r.t('tasks.nope');`,
        `i18n.t('errors:GONE');`,
        `const f = i18n.getFixedT(null, 'portal'); f('nope');`,
        `function g(t: TFunction<'portal'>) { t('nope'); }`,
        `const NS = 'portal'; const { t: tn } = useTranslation(NS); tn('nope');`,
        `const { t: tk } = useTranslation('portal', { keyPrefix: 'shell.nav' }); tk('documents');`,
      ].join('\n'),
      filename: FILE,
      options,
      errors: Array.from({ length: 7 }, () => ({ messageId: 'missingKey' as const })),
    },
    // A global / imported bare `t` resolves to the default namespace.
    {
      code: `import { t } from 'i18next'; t('actions.nope'); t('actions.save');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey' }],
    },
    // Plural forms do not answer a call without `count`: i18next looks up the bare key.
    {
      code: `const { t } = useTranslation(); t('items');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey' }],
    },
    // A subtree is not a string unless returnObjects asks for it.
    {
      code: `const { t } = useTranslation(); t('status'); t('status', { returnObjects: false });`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey' }, { messageId: 'missingKey' }],
    },
    // No fallback key exists.
    {
      code: `const { t } = useTranslation(); t(['a.b', 'c.d']);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey', data: { key: 'a.b` | `c.d', namespace: 'common', catalogs: `${SHARED}#common` } }],
    },
    // <Trans> keys are checked too.
    {
      code: `<Trans i18nKey="tasks.nope" ns="portal" />; <Trans i18nKey={'actions.nope'} />;`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingKey' }, { messageId: 'missingKey' }],
    },
    // A namespace with no catalog is a configuration / typo error, not a silent pass.
    {
      code: `const { t } = useTranslation('portl'); t('tasks.title');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unknownNamespace', data: { namespace: 'portl' } }],
    },
    // Path traversal in a namespace never reaches the filesystem.
    {
      code: `const { t } = useTranslation('..'); t('x');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unknownNamespace' }],
    },
    // A catalog that exists but will not parse is loud, once per file.
    {
      code: `const { t } = useTranslation('broken'); t('a'); t('b');`,
      filename: FILE,
      options,
      errors: [{ messageId: 'catalogUnreadable' }],
    },
    // A fixed catalog that is missing is loud too.
    {
      code: `const { t } = useTranslation(); t('a');`,
      filename: FILE,
      options: [{ catalogs: [{ file: path.join(FIXTURES, 'does-not-exist.json') }] }],
      errors: [{ messageId: 'catalogUnreadable' }],
    },
    // check-prefix: a template head no key starts with can never resolve.
    {
      code: `const { t } = useTranslation(); t(\`statuz.\${s}\`); t(someKey);`,
      filename: FILE,
      options: [{ ...base, dynamicKeys: 'check-prefix' }],
      errors: [{ messageId: 'missingKeyPrefix', data: { prefix: 'statuz.', namespace: 'common', catalogs: `${SHARED}#common` } }],
    },
    // Configurable callees.
    {
      code: `const { t } = useI18n('portal'); t('nope'); translate('nope'); tr.t('nope');`,
      filename: FILE,
      options: [{ ...base, hooks: ['useI18n'], functions: ['translate'], instances: ['tr'] }],
      errors: [{ messageId: 'missingKey' }, { messageId: 'missingKey' }, { messageId: 'missingKey' }],
    },
  ],
});

// Under typed linting, an identifier whose type is one string literal names the namespace,
// even when its declaration lives elsewhere (here: an ambient `declare const`).
const typed = {
  parserOptions: {
    projectService: { allowDefaultProject: ['*.tsx'] },
    tsconfigRootDir: FIXTURES,
  },
};
const DECLARED = `declare const PORTAL_NS: 'portal'; declare function useTranslation(ns?: string): { t: (k: string) => string };`;

ruleTester.run('translation-key-exists (typed)', translationKeyExistsRule, {
  valid: [
    { code: `${DECLARED} const { t } = useTranslation(PORTAL_NS); t('tasks.title');`, filename: path.join(FIXTURES, 'typed.tsx'), options, languageOptions: typed },
    // Untyped: the same namespace is unresolvable, so the rule stays silent.
    { code: `${DECLARED} const { t } = useTranslation(PORTAL_NS); t('nope');`, filename: FILE, options },
  ],
  invalid: [
    {
      code: `${DECLARED} const { t } = useTranslation(PORTAL_NS); t('nope');`,
      filename: path.join(FIXTURES, 'typed.tsx'),
      options,
      languageOptions: typed,
      errors: [{ messageId: 'missingKey', data: { key: 'nope', namespace: 'portal', catalogs: path.join(FIXTURES, 'features/portal/locales/pl.json') } }],
    },
  ],
});

describe('translation catalogs on a real, changing file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'translation-key-exists-'));
  const catalog = path.join(dir, 'en.json');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const keysOf = (): readonly string[] => {
    const { catalogs, errors } = catalogsForNamespace('translation', [{ file: catalog }], {
      cwd: dir,
      defaultNamespace: 'translation',
      keySeparator: '.',
    });
    expect(errors).toEqual([]);
    return catalogs.flatMap((entry) => [...entry.leaves]);
  };

  it('re-reads the catalog when it changes on disk', () => {
    writeFileSync(catalog, JSON.stringify({ hello: 'Hello' }));
    utimesSync(catalog, new Date(1_000), new Date(1_000));
    expect(keysOf()).toEqual(['hello']);

    writeFileSync(catalog, JSON.stringify({ hello: 'Hello', bye: 'Bye' }));
    utimesSync(catalog, new Date(2_000), new Date(2_000));
    expect(keysOf()).toEqual(['hello', 'bye']);
  });
});
