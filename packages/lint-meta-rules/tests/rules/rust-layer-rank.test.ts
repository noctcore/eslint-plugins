import { describe, expect, test } from 'bun:test';

import {
  cargoDependencies,
  crateModuleReferences,
  createRustLayerRankRule,
  rustModuleDepth,
} from '../../src/rules/rust-layer-rank';
import { createFakeCtx } from '../test-utils/createFakeCtx';

const RULE_ID = 'rust-layer-rank';

function run(files: Record<string, string>, options: Parameters<typeof createRustLayerRankRule>[0] = {}) {
  return createRustLayerRankRule(options).run(createFakeCtx({ files }));
}

describe('rust-layer-rank, module mode', () => {
  const ranks = { types: 1, io: 1, storage: 2, engine: 3, worker: 3, api: 4 };

  test('reports an upward import with file and line, and a sideways one', () => {
    const violations = run(
      {
        'src/storage/files.rs': '//! Files.\nuse crate::types::Id;\nuse crate::engine::Runner;\n',
        'src/types.rs': 'use crate::io::Clock;\n',
      },
      { ranks },
    );

    expect(violations).toHaveLength(2);
    expect(violations[0]?.file).toBe('src/storage/files.rs');
    expect(violations[0]?.rule).toBe(RULE_ID);
    expect(violations[0]?.line).toBe(3);
    expect(violations[0]?.message ?? '').toMatch(
      /^line 3: forbidden upward reference: storage \(rank 2\) on engine \(rank 3\)/u,
    );
    expect(violations[1]?.message ?? '').toContain('forbidden sideways reference: types (rank 1) on io (rank 1)');
  });

  test('accepts downward imports and imports inside the same module', () => {
    expect(
      run(
        { 'src/api/routes.rs': 'use crate::engine::Runner;\nuse crate::api::auth;\nuse crate::types::Id;\n' },
        { ranks },
      ),
    ).toEqual([]);
  });

  test('reads grouped imports', () => {
    const violations = run({ 'src/storage/x.rs': 'use crate::{types::Id, engine::{Runner, Job}, self};\n' }, { ranks });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('on engine (rank 3)');
    expect(crateModuleReferences('use crate::{a, b::{c, d}, e::f};').map((ref) => ref.name)).toEqual(['a', 'b', 'e']);
  });

  test('does not read comments, strings or test modules', () => {
    const text = [
      '// use crate::engine::Runner;',
      '/// Never import crate::api from here.',
      'const DOC: &str = "crate::engine";',
      '#[cfg(test)]',
      'mod tests {',
      '    use crate::api::Router;',
      '}',
      '',
    ].join('\n');

    expect(run({ 'src/storage/x.rs': text }, { ranks })).toEqual([]);
    expect(run({ 'src/storage/x.rs': text }, { ranks, skipTestModules: false })).toHaveLength(1);
  });

  test('reports once per file and target', () => {
    expect(
      run({ 'src/storage/x.rs': 'use crate::engine::A;\nfn f() { crate::engine::b(); }\n' }, { ranks }),
    ).toHaveLength(1);
  });

  test('skips unranked modules on either side', () => {
    expect(run({ 'src/util/x.rs': 'use crate::api::A;\n', 'src/types.rs': 'use crate::util::B;\n' }, { ranks })).toEqual(
      [],
    );
  });

  test('is inert without ranks', () => {
    expect(run({ 'src/storage/x.rs': 'use crate::engine::A;\n' })).toEqual([]);
  });

  test('resolves facade aliases before ranking', () => {
    const files = { 'src/types.rs': 'use crate::settings::Load;\n' };

    expect(run(files, { ranks })).toEqual([]);
    expect(run(files, { ranks, facades: { settings: 'storage' } })).toHaveLength(1);
  });

  test('resolves leading super:: segments from the module depth of the file', () => {
    expect(['lib.rs', 'main.rs', 'store.rs', 'store/mod.rs', 'store/disk.rs', 'store/disk/mod.rs', 'a/b/c.rs'].map(rustModuleDepth)).toEqual([
      0, 0, 1, 1, 2, 2, 3,
    ]);

    const violations = run(
      {
        'src/storage.rs': 'use super::engine::Runner;\nuse super::{types::Id, api};\n',
        'src/storage/disk.rs': 'use super::super::engine::Job;\nuse super::cache::Lru;\n',
        'src/storage/disk/mod.rs': 'use super::super::api::Router;\nuse super::files;\n',
      },
      { ranks },
    );

    expect(violations.map((violation) => [violation.file, violation.line])).toEqual([
      ['src/storage.rs', 1],
      ['src/storage.rs', 2],
      ['src/storage/disk.rs', 1],
      ['src/storage/disk/mod.rs', 1],
    ]);
    expect(violations[0]?.message ?? '').toContain('storage (rank 2) on engine (rank 3)');
    expect(violations[1]?.message ?? '').toContain('on api (rank 4)');
    // A super:: path that stays below the root, or climbs past it, names no top-level module.
    expect(crateModuleReferences('use super::x;', 2)).toEqual([]);
    expect(crateModuleReferences('use super::super::x;', 1)).toEqual([]);
    expect(crateModuleReferences('use super::x;', 0)).toEqual([]);
  });

  test('stops a grouped import at a semicolon or a bounded distance, and stays fast on unclosed groups', () => {
    expect(crateModuleReferences('use crate::{a, b;\nfn f() { other::{c, d} }').map((ref) => ref.name)).toEqual(['a', 'b']);
    expect(crateModuleReferences(`use crate::{a, ${' '.repeat(5000)}b}`).map((ref) => ref.name)).toEqual(['a']);

    const hostile = 'use crate::{'.repeat(20_000);
    const start = performance.now();
    run({ 'src/storage/x.rs': hostile }, { ranks });
    crateModuleReferences(hostile);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test('reads facades as own keys only', () => {
    const files = { 'src/types.rs': 'use crate::constructor::X;\nuse crate::__proto__::Y;\n' };

    expect(run(files, { ranks: Object.fromEntries([['types', 1], ['constructor', 2], ['__proto__', 2]]) })).toHaveLength(2);
    expect(run(files, { ranks: { ...ranks, constructor: 2 }, facades: {} })).toHaveLength(1);
  });

  test('toleratedGroups allows equal-rank edges inside a group, and forbiddenEdges still reports', () => {
    const files = {
      'src/engine/a.rs': 'use crate::worker::Pool;\n',
      'src/worker/b.rs': 'use crate::engine::Core;\n',
    };
    const forbiddenEdges = [{ from: 'worker', to: 'engine', message: 'worker reaches the engine through the Dispatch trait.' }];

    expect(run(files, { ranks })).toHaveLength(2);
    expect(run(files, { ranks, toleratedGroups: [['engine', 'worker']] })).toEqual([]);
    const violations = run(files, { ranks, toleratedGroups: [['engine', 'worker']], forbiddenEdges });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toBe('line 1: worker reaches the engine through the Dispatch trait.');
  });

  test('a forbidden edge needs no ranks', () => {
    const violations = run(
      { 'src/worker/b.rs': 'use crate::engine::Core;\n' },
      { id: 'worker-seam', forbiddenEdges: [{ from: 'worker', to: 'engine' }] },
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe('worker-seam');
    expect(violations[0]?.message ?? '').toContain('worker must not reference engine');
  });

  test('root and exempt', () => {
    const files = { 'app/src/storage/x.rs': 'use crate::engine::A;\n', 'app/src/storage/tests.rs': 'use crate::api::A;\n' };

    expect(run(files, { ranks })).toEqual([]);
    expect(run(files, { ranks, root: 'app/src' })).toHaveLength(2);
    expect(run(files, { ranks, root: 'app/src', exempt: ['**/tests.rs'] })).toHaveLength(1);
  });
});

describe('rust-layer-rank, crate mode', () => {
  const ranks = { core: 0, net: 1, db: 2, library: 3, app: 99 };
  const base = { mode: 'crate' as const, cratePrefix: 'acme', ranks };

  test('reports an upward or sideways crate path in source, with the crate names', () => {
    const violations = run(
      {
        'crates/acme-db/src/lib.rs': 'use acme_core::Id;\nuse acme_library::Shelf;\n',
        'crates/acme-net/src/lib.rs': 'pub fn f() { acme_net::x(); }\n',
      },
      base,
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe('crates/acme-db/src/lib.rs');
    expect(violations[0]?.line).toBe(2);
    expect(violations[0]?.message ?? '').toContain('forbidden upward reference: acme-db (rank 2) on acme-library (rank 3)');
  });

  test('reports a Cargo.toml dependency entry, in any table form', () => {
    const toml = [
      '[package]',
      'name = "acme-net"',
      '',
      '[dependencies]',
      'acme-core = { path = "../acme-core" }',
      'acme-db.workspace = true',
      '',
      '[dev-dependencies]',
      'acme-library = { path = "../acme-library" } # for fixtures',
      '',
    ].join('\n');
    const violations = run({ 'crates/acme-net/Cargo.toml': toml }, base);

    expect(violations.map((violation) => violation.line)).toEqual([6, 9]);
    expect(violations[0]?.message ?? '').toContain('forbidden upward dependency: acme-net (rank 1) on acme-db (rank 2)');
  });

  test('a crate outside crates/ is named through crateDirs, and may depend on anything below it', () => {
    const files = {
      'apps/desktop/src/main.rs': 'use acme_library::Shelf;\n',
      'crates/acme-library/src/lib.rs': 'pub fn f() {}\n',
    };
    const options = { ...base, roots: ['crates', 'apps/desktop/src'], crateDirs: { 'apps/desktop/': 'app' } };

    expect(run(files, options)).toEqual([]);
    const upward = { ...files, 'crates/acme-db/src/lib.rs': 'pub use acme_app::State;\n' };
    const violations = run(upward, { ...options, ranks: { ...ranks } });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message ?? '').toContain('acme-db (rank 2) on app (rank 99)');
  });

  test('does not read comments or strings, and skips unranked crates', () => {
    const text = '//! acme_library must never be imported here.\nconst NAME: &str = "acme_library";\nuse acme_tools::x;\n';

    expect(run({ 'crates/acme-db/src/lib.rs': text }, base)).toEqual([]);
  });

  test('a prefix with a dash matches the underscore form in paths', () => {
    const violations = run(
      { 'crates/my-app-core/src/lib.rs': 'use my_app_db::Pool;\n' },
      { mode: 'crate', cratePrefix: 'my-app', ranks: { core: 0, db: 1 } },
    );

    expect(violations).toHaveLength(1);
  });

  test('a crate name counts only as a path or a use / extern crate declaration', () => {
    const text = [
      'const acme_library_url: &str = "x";',
      'let acme_library_count = 1;',
      'use foo::acme_library::Shelf;',
      'mod acme_library {}',
      '',
    ].join('\n');

    expect(run({ 'crates/acme-db/src/lib.rs': text }, base)).toEqual([]);
    for (const line of ['use acme_library;', 'extern crate acme_library;', 'use ::acme_library::Shelf;', 'let s = acme_library :: Shelf::new();']) {
      expect(run({ 'crates/acme-db/src/lib.rs': `${line}\n` }, base)).toHaveLength(1);
    }
  });

  test('reads renamed, quoted and table-header dependencies, and only inside dependency tables', () => {
    const toml = [
      '[package]',
      'name = "acme-net"',
      '',
      '[features]',
      'acme-db = []',
      '',
      '[dependencies]',
      'storage = { package = "acme-db", path = "../acme-db" }',
      '"acme-library" = "1"',
      '',
      '[target.\'cfg(unix)\'.dependencies.lib]',
      'package = "acme-app"',
      'path = "../acme-app"',
      '',
      '[build-dependencies.acme-db]',
      'path = "../acme-db"',
      '',
    ].join('\n');

    expect(cargoDependencies(toml)).toEqual([
      { crate: 'acme-db', line: 8 },
      { crate: 'acme-library', line: 9 },
      { crate: 'acme-app', line: 11 },
      { crate: 'acme-db', line: 15 },
    ]);
    const violations = run({ 'crates/acme-net/Cargo.toml': toml }, base);
    expect(violations.map((violation) => violation.line)).toEqual([8, 9, 11]);
    expect(violations[2]?.message ?? '').toContain('on acme-app (rank 99)');
  });

  test('ciCritical defaults to true and can be turned off', () => {
    expect(createRustLayerRankRule().ciCritical).toBe(true);
    expect(createRustLayerRankRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
