import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IMetaCtx } from '@noctcore/harness';

import {
  createTranslationDeadKeysRule,
  deriveNamespaces,
  type TranslationDeadKeysOptions,
} from '../../src/i18n';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/**
 * A ctx over files that ALSO exist on disk: the catalog loader shared with
 * `translation-key-exists` reads catalogs from the filesystem, not through ctx.
 */
function realDirCtx(files: Record<string, string>): IMetaCtx {
  const root = mkdtempSync(path.join(tmpdir(), 'dead-keys-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text, 'utf8');
  }
  return createFakeCtx({ files, root });
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const COMMON = {
  used: 'Used',
  plural_one: 'One',
  plural_other: 'Many',
  status: { active: 'Active', archived: 'Archived' },
  nav: { home: 'Home', settings: 'Settings' },
  errors: { NOT_FOUND: 'Not found' },
  tour: { first: 'First', second: 'Second' },
  external: { fromServer: 'Sent by the API' },
  qualified: 'Qualified',
  dead: 'Nobody says this',
  deadBranch: { leaf: 'Nor this' },
};

const ADMIN = { title: 'Admin', unused: 'Unused' };

const APP = `
import { useTranslation } from 'react-i18next';

const NAV = [{ labelKey: 'nav.home' }];
const QUALIFIED = 'common:qualified';

export function App({ status, code, count }: { status: string; code: string; count: number }) {
  const { t } = useTranslation();
  const { t: ta } = useTranslation('admin');
  return (
    <div>
      {t('used')}
      {t('plural', { count })}
      {t(\`status.\${status}\`)}
      {NAV.map((item) => t(item.labelKey))}
      {t('errors.' + code)}
      {String(t('tour', { returnObjects: true }))}
      {t(QUALIFIED)}
      {ta('title')}
    </div>
  );
}
`;

const FIXTURE: Record<string, string> = {
  'locales/en/common.json': json(COMMON),
  'locales/en/admin.json': json(ADMIN),
  'src/App.tsx': APP,
};

const OPTIONS: TranslationDeadKeysOptions = {
  catalogs: [{ file: 'locales/en/{ns}.json' }],
  defaultNamespace: 'common',
  sourceGlobs: ['src/**/*.ts', 'src/**/*.tsx'],
  allow: ['common:external.*'],
};

function deadKeys(files: Record<string, string>, options: TranslationDeadKeysOptions = OPTIONS): string[] {
  return createTranslationDeadKeysRule(options)
    .run?.(realDirCtx(files))
    .map((violation) => /`([^`]+)`/u.exec(violation.message)?.[1] ?? violation.message) ?? [];
}

describe('translation-dead-keys', () => {
  test('reports exactly the keys nothing reaches, one per key', () => {
    expect(deadKeys(FIXTURE).sort()).toEqual(
      ['admin:unused', 'common:dead', 'common:deadBranch.leaf', 'common:nav.settings'].sort(),
    );
  });

  test('names the catalog file and says how to fix it', () => {
    const violation = createTranslationDeadKeysRule(OPTIONS)
      .run?.(realDirCtx({ ...FIXTURE, 'locales/en/common.json': json({ used: 'Used', gone: 'x' }) }))
      .find((candidate) => candidate.message.includes('`common:gone`'));

    expect(violation?.rule).toBe('translation-dead-keys');
    expect(violation?.file).toBe('locales/en/common.json');
    expect(violation?.message).toMatch(/`common:gone`.*Delete it, or add it to `allow`/u);
  });

  test('counts every route a key can take: call, plural, template, data table, concat, returnObjects, ns-qualified literal, allow', () => {
    const reached = [
      'common:used',
      'common:plural_one',
      'common:plural_other',
      'common:status.active',
      'common:status.archived',
      'common:nav.home',
      'common:errors.NOT_FOUND',
      'common:tour.first',
      'common:tour.second',
      'common:qualified',
      'common:external.fromServer',
      'admin:title',
    ];
    const dead = deadKeys(FIXTURE);
    for (const key of reached) expect(dead).not.toContain(key);
  });

  test('a key reached only in ANOTHER namespace is still dead in its own', () => {
    const dead = deadKeys({
      ...FIXTURE,
      'src/Other.tsx': "import { useTranslation } from 'react-i18next';\nexport const O = () => useTranslation('admin').t('only.admin');\n",
      'locales/en/admin.json': json({ ...ADMIN, only: { admin: 'A' } }),
      'locales/en/common.json': json({ ...COMMON, only: { common: 'C' } }),
    });

    expect(dead).toContain('common:only.common');
    expect(dead).not.toContain('admin:only.admin');
  });

  test('is inert without catalogs or source globs', () => {
    expect(deadKeys(FIXTURE, { ...OPTIONS, catalogs: [] })).toEqual([]);
    expect(deadKeys(FIXTURE, { ...OPTIONS, sourceGlobs: [] })).toEqual([]);
  });

  test('reports NO dead key when a source file cannot be parsed, only the file', () => {
    const violations = createTranslationDeadKeysRule(OPTIONS).run?.(
      realDirCtx({ ...FIXTURE, 'src/Broken.ts': 'export const = ;' }),
    ) ?? [];

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('src/Broken.ts');
    expect(violations[0]?.message).toMatch(/Could not analyse this file/u);
  });

  test('refuses to call everything dead when sourceGlobs match nothing', () => {
    const violations = createTranslationDeadKeysRule({ ...OPTIONS, sourceGlobs: ['app/**/*.tsx'] }).run?.(
      realDirCtx(FIXTURE),
    ) ?? [];

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/No source file matches `sourceGlobs`/u);
  });

  test('surfaces a catalog that will not parse instead of guessing', () => {
    const violations = createTranslationDeadKeysRule(OPTIONS).run?.(
      realDirCtx({ ...FIXTURE, 'locales/en/admin.json': '{ not json' }),
    ) ?? [];

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/Catalog could not be loaded: locales\/en\/admin\.json/u);
  });

  test('resolves a static key under a keyPrefix binding through the shared visitor', () => {
    // No string spells `form.email`: only the visitor's binding resolution reaches it.
    const dead = deadKeys({
      'locales/en/common.json': json({ form: { email: 'Email', phone: 'Phone' } }),
      'src/Form.tsx':
        "import { useTranslation } from 'react-i18next';\nexport const F = () => { const { t } = useTranslation('common', { keyPrefix: 'form' }); return t('email'); };\n",
    });

    expect(dead).toEqual(['common:form.phone']);
  });

  test('KNOWN BLIND SPOT: a variable key under a keyPrefix binding is reported dead', () => {
    // `t(field)` with field = 'name' under keyPrefix 'form' reaches `form.name`,
    // but no string spells `form.name`. Pinned here so the docs stay honest.
    const dead = deadKeys({
      'locales/en/common.json': json({ form: { name: 'Name' } }),
      'src/Form.tsx':
        "import { useTranslation } from 'react-i18next';\nconst FIELDS = ['name'];\nexport const F = () => { const { t } = useTranslation('common', { keyPrefix: 'form' }); return FIELDS.map((field) => t(field)); };\n",
    });

    expect(dead).toEqual(['common:form.name']);
  });
});

describe('deriveNamespaces', () => {
  test('globs a {ns} file segment and lists the keys under a trailing {ns} keyPath', () => {
    const ctx = createFakeCtx({
      files: {
        'features/billing/locales/en.json': '{}',
        'features/help/locales/en.json': '{}',
        'shared/en.json': json({ common: {}, errors: {} }),
      },
    });

    expect(
      deriveNamespaces(
        ctx,
        [
          { file: 'features/{ns}/locales/en.json' },
          { file: 'shared/en.json', keyPath: '{ns}' },
          { file: 'fixed.json', namespace: 'fixed' },
        ],
        'common',
      ),
    ).toEqual(['billing', 'common', 'errors', 'fixed', 'help']);
  });

  test('throws when a {ns} placeholder cannot be enumerated, asking for `namespaces`', () => {
    const ctx = createFakeCtx({ files: { 'all.json': '{}' } });

    expect(() => deriveNamespaces(ctx, [{ file: 'all.json', keyPath: '{ns}.strings' }], 'common')).toThrow(
      /list them in `namespaces`/u,
    );
  });
});

describe('translation-dead-keys on a real tree through the harness CLI', () => {
  // Catalogs in a dot-directory, so namespace discovery goes through the real glob.
  const files = {
    '.i18n/en/common.json': json(COMMON),
    '.i18n/en/admin.json': json(ADMIN),
    'src/App.tsx': APP,
  };
  const options = { ...OPTIONS, catalogs: [{ file: '.i18n/en/{ns}.json' }] };
  const expected = [
    '.i18n/en/admin.json: admin:unused',
    '.i18n/en/common.json: common:dead',
    '.i18n/en/common.json: common:deadBranch.leaf',
    '.i18n/en/common.json: common:nav.settings',
  ];
  const summarise = (violations: readonly string[]): string[] =>
    violations
      .map((line) => {
        const match = /^translation-dead-keys \(([^)]+)\): Translation key `([^`]+)`/u.exec(line);
        return match === null ? line : `${match[1]}: ${match[2]}`;
      })
      .sort();

  test(
    'under Bun with ESLint 10, from source',
    () => {
      const run = runLintMetaOnRealTree(files, 'createTranslationDeadKeysRule', options);

      expect(run.stdout).toMatch(/^eslint 10\./mu);
      expect(summarise(run.violations)).toEqual(expected);
      expect(run.code).toBe(1);
    },
    60_000,
  );

  test(
    'under Node with ESLint 9.0.0 (the peer floor), from the built package',
    () => {
      const run = runLintMetaOnRealTree(files, 'createTranslationDeadKeysRule', options, {
        runtime: 'node-eslint9',
      });

      expect(run.stdout).toMatch(/^eslint 9\.0\.0$/mu);
      expect(summarise(run.violations)).toEqual(expected);
      expect(run.code).toBe(1);
    },
    60_000,
  );
});
