import assert from 'node:assert/strict';
import { describe, it } from 'bun:test';

import { createFixture, messages, runSync } from '../test-utils/diskFixture';
import type { DiskFixture as IFixture } from '../test-utils/diskFixture';
import type { IViolation } from '@noctcore/harness';

import { createPnpmOverrideLedgerRule } from '../../src/rules/pnpm-override-ledger';
import { diskCtx } from '../test-utils/diskFixture';

const pnpmOverrideLedgerRule = createPnpmOverrideLedgerRule();

function checkPnpmOverrideLedger(root: string, today: Date): IViolation[] {
  return createPnpmOverrideLedgerRule({ now: () => today }).run?.(diskCtx(root)) ?? [];
}

/*
 * A frozen "today" so the reviewBy cases mean the same thing next year. Every
 * date below is written relative to it.
 */
const TODAY = new Date('2026-09-20T00:00:00Z');
const FUTURE = '2026-12-01';
const PAST = '2026-08-01';

const TAR_ENTRY = {
  kind: 'security',
  advisories: ['GHSA-r292-9mhp-454m'],
  firstPatched: '7.5.21',
  reason: 'The advisory range is <=7.5.20.',
  reviewBy: FUTURE,
};

function manifest(overrides: Record<string, string>): string {
  return JSON.stringify({ name: 'fixture', pnpm: { overrides } }, null, 2);
}

function lockfile(overrides: Record<string, string>, resolved: readonly string[]): string {
  const overrideLines = Object.entries(overrides).map(([key, value]) => `  ${key}: ${value}`);
  const packageLines = resolved.map((key) => `  ${key}:\n    resolution: {integrity: sha512-x}`);

  return [
    "lockfileVersion: '9.0'",
    '',
    'overrides:',
    ...overrideLines,
    '',
    'packages:',
    '',
    ...packageLines,
    '',
    'snapshots:',
    '',
    ...resolved.map((key) => `  ${key}: {}`),
    '',
  ].join('\n');
}

/** A fixture whose override, ledger entry and lockfile all agree. */
function cleanFixture(): IFixture {
  return createFixture({
    'package.json': manifest({ 'tar@<7.5.21': '^7.5.21' }),
    'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.21': TAR_ENTRY }, null, 2),
    'pnpm-lock.yaml': lockfile({ 'tar@<7.5.21': '^7.5.21' }, ['tar@7.5.21']),
  });
}

describe('pnpm-override-ledger', () => {
  it('passes an override whose ledger entry and lockfile both agree with it', () => {
    assert.deepEqual(checkPnpmOverrideLedger(cleanFixture().root, TODAY), []);
  });

  it('stays dormant when the repo declares no overrides and has no ledger', () => {
    const fixture = createFixture({ 'package.json': JSON.stringify({ name: 'fixture' }) });

    assert.deepEqual(checkPnpmOverrideLedger(fixture.root, TODAY), []);
  });

  it('reports an override with no ledger entry', () => {
    const fixture = cleanFixture();
    fixture.write({
      'package.json': manifest({ 'tar@<7.5.21': '^7.5.21', 'tmp@<0.2.6': '^0.2.6' }),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'pnpm-override-ledger');
    assert.match(violations[0]?.message ?? '', /`tmp@<0\.2\.6` is overridden .* no ledger entry/u);
  });

  it('reports a ledger entry with no override', () => {
    const fixture = cleanFixture();
    fixture.write({
      'overrides.ledger.json': JSON.stringify(
        { 'tar@<7.5.21': TAR_ENTRY, 'hono@<4.12.27': { ...TAR_ENTRY, firstPatched: '4.12.27' } },
        null,
        2,
      ),
    });

    assert.deepEqual(messages(checkPnpmOverrideLedger(fixture.root, TODAY)), [
      '`hono@<4.12.27` has a ledger entry but no matching override. Delete the entry, or restore the override if it was dropped by accident.',
    ]);
  });

  it('reports a whole override block with no ledger file at all', () => {
    const fixture = createFixture({
      'package.json': manifest({ react: '^19.2.6' }),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /overrides.ledger\.json does not exist/u);
  });

  it('reports a reviewBy that is missing, unreadable or in the past', () => {
    const cases: Record<string, RegExp> = {
      '': /not a yyyy-MM-dd date/u,
      soon: /not a yyyy-MM-dd date/u,
      '2026-13-45': /not a real date/u,
      [PAST]: /was due for review on 2026-08-01/u,
    };

    for (const [reviewBy, expected] of Object.entries(cases)) {
      const fixture = cleanFixture();
      fixture.write({
        'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.21': { ...TAR_ENTRY, reviewBy } }),
      });

      const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

      assert.equal(violations.length, 1, `reviewBy "${reviewBy}" should report exactly one`);
      assert.match(violations[0]?.message ?? '', expected);
    }
  });

  /*
   * The frozen TODAY above is midnight UTC, the one instant at which "is the
   * due date's midnight still ahead of now" and "is today's date past the due
   * date" agree. So the day is walked: its first second, three in the morning
   * in Warsaw in winter and in summer time, the afternoon, its last second.
   */
  it('keeps an entry green for the whole of its reviewBy day, by the UTC calendar', () => {
    const fixture = cleanFixture();
    fixture.write({
      'overrides.ledger.json': JSON.stringify({
        'tar@<7.5.21': { ...TAR_ENTRY, reviewBy: '2026-12-01' },
      }),
    });

    for (const now of [
      '2026-12-01T00:00:00Z',
      '2026-12-01T00:00:01Z',
      '2026-12-01T03:00:00+01:00',
      '2026-12-01T03:00:00+02:00',
      '2026-12-01T15:30:00Z',
      '2026-12-01T23:59:59Z',
    ]) {
      assert.deepEqual(checkPnpmOverrideLedger(fixture.root, new Date(now)), [], now);
    }
  });

  it('reports the entry from the first second of the day after its reviewBy', () => {
    const fixture = cleanFixture();
    fixture.write({
      'overrides.ledger.json': JSON.stringify({
        'tar@<7.5.21': { ...TAR_ENTRY, reviewBy: '2026-12-01' },
      }),
    });

    for (const now of ['2026-12-02T00:00:00Z', '2026-12-02T00:00:01Z', '2027-01-01T12:00:00Z']) {
      const violations = checkPnpmOverrideLedger(fixture.root, new Date(now));
      assert.equal(violations.length, 1, now);
      assert.match(violations[0]?.message ?? '', /was due for review on 2026-12-01/u, now);
    }
  });

  it('reports a day its month does not have, which a date parser rolls into the next month', () => {
    for (const reviewBy of ['2026-02-30', '2026-04-31', '2027-02-29']) {
      const fixture = cleanFixture();
      fixture.write({
        'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.21': { ...TAR_ENTRY, reviewBy } }),
      });

      const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

      assert.equal(violations.length, 1, reviewBy);
      assert.match(violations[0]?.message ?? '', /which is not a real date/u, reviewBy);
    }
  });

  it('reports an entry with no reviewBy field at all', () => {
    const fixture = cleanFixture();
    const { reviewBy: _dropped, ...undated } = TAR_ENTRY;
    fixture.write({
      'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.21': undated }),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /`reviewBy` is missing/u);
  });

  it('reports a security pin that lands below its own firstPatched', () => {
    // The 2026-07-31 failure, written out: the advisory range was <=7.5.20, so
    // the override fired on every install and still landed on 7.5.20.
    const fixture = createFixture({
      'package.json': manifest({ 'tar@<7.5.22': '7.5.20' }),
      'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.22': TAR_ENTRY }),
      'pnpm-lock.yaml': lockfile({ 'tar@<7.5.22': '7.5.20' }, ['tar@7.5.20']),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.match(
      violations.map((entry) => entry.message).join('\n'),
      /lowest resolvable version is below its own `firstPatched` \(7\.5\.21\)/u,
    );
  });

  it('accepts a security pin that sits exactly on firstPatched', () => {
    const fixture = createFixture({
      'package.json': manifest({ 'tmp@<0.2.6': '^0.2.6' }),
      'overrides.ledger.json': JSON.stringify({
        'tmp@<0.2.6': { ...TAR_ENTRY, firstPatched: '0.2.6' },
      }),
      'pnpm-lock.yaml': lockfile({ 'tmp@<0.2.6': '^0.2.6' }, ['tmp@0.2.7']),
    });

    assert.deepEqual(checkPnpmOverrideLedger(fixture.root, TODAY), []);
  });

  it('reports a security entry with no firstPatched to check the pin against', () => {
    const fixture = cleanFixture();
    const { firstPatched: _dropped, ...unchecked } = TAR_ENTRY;
    fixture.write({
      'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.21': unchecked }),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /security override with no `firstPatched`/u);
  });

  it('reports a lockfile that still resolves a version inside the selector', () => {
    const fixture = cleanFixture();
    fixture.write({
      'pnpm-lock.yaml': lockfile({ 'tar@<7.5.21': '^7.5.21' }, ['tar@7.5.21', 'tar@7.5.20']),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /still resolves tar@7\.5\.20/u);
    assert.equal(violations[0]?.file, 'pnpm-lock.yaml');
  });

  it('reports a selector-less pin that the lockfile resolves more than once', () => {
    const fixture = createFixture({
      'package.json': manifest({ react: '^19.2.6' }),
      'overrides.ledger.json': JSON.stringify({
        react: { kind: 'unify', reason: 'One React or hooks break.', reviewBy: FUTURE },
      }),
      'pnpm-lock.yaml': lockfile({ react: '^19.2.6' }, ['react@19.2.8', 'react@18.3.1']),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /resolves 2: 19\.2\.8, 18\.3\.1/u);
  });

  it('reports a lockfile whose overrides block disagrees with package.json', () => {
    const fixture = cleanFixture();
    fixture.write({
      'pnpm-lock.yaml': lockfile({ 'tar@<7.5.21': '^7.5.20' }, ['tar@7.5.21']),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /reads "\^7\.5\.20" in the lockfile/u);
  });

  it('reports a malformed entry instead of treating it as documented', () => {
    const fixture = cleanFixture();
    fixture.write({
      'overrides.ledger.json': JSON.stringify({
        'tar@<7.5.21': { kind: 'whatever', reason: 'x', reviewBy: FUTURE },
      }),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /`kind` must be "security" or "unify"/u);
  });

  it('reports a selector shape the lockfile check cannot read', () => {
    const fixture = createFixture({
      'package.json': manifest({ 'tar@^7.5.0': '^7.5.21' }),
      'overrides.ledger.json': JSON.stringify({ 'tar@^7.5.0': TAR_ENTRY }),
      'pnpm-lock.yaml': lockfile({ 'tar@^7.5.0': '^7.5.21' }, ['tar@7.5.21']),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /selector this rule cannot read/u);
  });

  it('runs through the registered rule against the live tree contract', () => {
    const fixture = cleanFixture();
    fixture.write({
      'overrides.ledger.json': JSON.stringify({}),
    });

    const violations = runSync(pnpmOverrideLedgerRule, fixture.context());

    assert.equal(violations.length, 1);
    assert.equal(violations[0]?.rule, 'pnpm-override-ledger');
  });
});

describe('pnpm-override-ledger, beyond package.json', () => {
  it('reads overrides declared in pnpm-workspace.yaml as well', () => {
    const fixture = createFixture({
      'pnpm-workspace.yaml': "packages:\n  - 'apps/*'\n\noverrides:\n  'tar@<7.5.21': ^7.5.21\n  tmp@<0.2.6: 0.2.6 # pinned\n",
      'overrides.ledger.json': JSON.stringify({ 'tar@<7.5.21': TAR_ENTRY }, null, 2),
      'pnpm-lock.yaml': lockfile({}, ['tar@7.5.21']),
    });

    const violations = checkPnpmOverrideLedger(fixture.root, TODAY);

    assert.equal(violations.length, 1);
    assert.match(violations[0]?.message ?? '', /`tmp@<0\.2\.6` is overridden to "0\.2\.6" with no ledger entry/u);
  });

  it('honours another ledger path', () => {
    const fixture = cleanFixture();
    fixture.write({ 'overrides.ledger.json': '{}', 'docs/deps/ledger.json': JSON.stringify({ 'tar@<7.5.21': TAR_ENTRY }) });
    const rule = createPnpmOverrideLedgerRule({ ledgerFile: 'docs/deps/ledger.json', now: () => TODAY });
    assert.deepEqual(runSync(rule, fixture.context()), []);
  });
});
