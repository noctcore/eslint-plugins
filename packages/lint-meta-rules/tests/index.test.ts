import { describe, expect, test } from 'bun:test';

import * as pkg from '../src/index';
import { RULE_FACTORIES, RULE_IDS, createAllRules } from '../src/index';

describe('package export surface', () => {
  test('RULE_FACTORIES covers every rule id and each is a factory', () => {
    expect(RULE_IDS.sort()).toEqual(
      [
        'agents-doc-presence',
        'canonical-helpers-single-home',
        'dockerfile-base-image-digest-pin',
        'file-size-ratchet',
        'github-actions-least-privilege-permissions',
        'github-actions-no-template-injection',
        'github-actions-runner-pinned',
        'github-actions-sha-pinned',
        'layer-rank',
        'no-cloned-component-folders',
        'no-warn-severity',
        'package-shape',
        'security-scanner-version-parity',
        'service-image-digest-pin',
        'test-runner-segregation',
        'test-sibling-enforcement',
        'test-workspace-enrollment',
        'ui-primitive-shape',
        'workspace-graph-parity',
      ].sort(),
    );
    for (const id of RULE_IDS) {
      expect(typeof RULE_FACTORIES[id]).toBe('function');
    }
  });

  test('createAllRules() instantiates every factory with defaults', () => {
    const rules = createAllRules();
    expect(rules).toHaveLength(RULE_IDS.length);
    for (const r of rules) {
      expect(typeof r.id).toBe('string');
      expect(typeof r.run).toBe('function');
      expect(['config', 'source-text', 'supply-chain', 'ci', 'testing']).toContain(r.category);
    }
  });

  test('every create* factory and countLines is exported by name', () => {
    const expected = [
      'createAgentsDocPresenceRule',
      'createCanonicalHelpersSingleHomeRule',
      'createDockerfileBaseImageDigestPinRule',
      'createFileSizeRatchetRule',
      'createGithubActionsLeastPrivilegePermissionsRule',
      'createGithubActionsNoTemplateInjectionRule',
      'createGithubActionsRunnerPinnedRule',
      'createGithubActionsShaPinnedRule',
      'createLayerRankRule',
      'createNoClonedComponentFoldersRule',
      'createNoWarnSeverityRule',
      'createPackageShapeRule',
      'createSecurityScannerVersionParityRule',
      'createServiceImageDigestPinRule',
      'createTestRunnerSegregationRule',
      'createTestSiblingEnforcementRule',
      'createTestWorkspaceEnrollmentRule',
      'createUiPrimitiveShapeRule',
      'createWorkspaceGraphParityRule',
      'countLines',
    ];
    for (const name of expected) {
      expect(typeof (pkg as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

describe('sub-path entry points', () => {
  test('resolved-config and prisma export their factories, and the main entry does not', async () => {
    const resolvedConfig = await import('../src/resolved-config');
    const prisma = await import('../src/prisma');
    expect(typeof resolvedConfig.createEslintConfigNoWarnRule).toBe('function');
    expect(typeof prisma.createTenantModelRegistryParityRule).toBe('function');
    expect(typeof prisma.createPrismaMethodSurfaceRule).toBe('function');
    for (const name of [
      'createEslintConfigNoWarnRule',
      'createTenantModelRegistryParityRule',
      'createPrismaMethodSurfaceRule',
    ]) {
      expect((pkg as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  test('session and trpc export their factories, inert with no options, and the main entry does not', async () => {
    const session = await import('../src/session');
    const trpc = await import('../src/trpc');
    const factories: Record<string, unknown> = {
      createSessionEpochCapturedRule: session.createSessionEpochCapturedRule,
      createSessionKindStampedRule: session.createSessionKindStampedRule,
      createSessionLandingDeclaredRule: session.createSessionLandingDeclaredRule,
      createSessionMintCallersRule: session.createSessionMintCallersRule,
      createIdempotencyKeyParityRule: trpc.createIdempotencyKeyParityRule,
    };
    // A ctx whose every file is a mint, a door and a guarded router: a default
    // rule that read anything would report.
    const ctx = {
      root: '/fake',
      read: () => "@Router({ alias: 'a' }) @UseMiddlewares(IdempotencyMiddleware) async b() {} this.establishSession({}); x.beginOrEstablish({});",
      exists: () => true,
      glob: () => ['apps/api/src/a.router.ts'],
      exec: () => ({ code: 0, stdout: '', stderr: '' }),
    };
    for (const [name, factory] of Object.entries(factories)) {
      expect(typeof factory).toBe('function');
      const rule = (factory as () => { run: (c: typeof ctx) => unknown[] })();
      expect(rule.run(ctx)).toEqual([]);
      expect((pkg as Record<string, unknown>)[name]).toBeUndefined();
    }
  });

  test('package.json exports every entry the build emits', async () => {
    const manifest = (await import('../package.json')).default as {
      exports: Record<string, unknown>;
      scripts: { build: string };
    };
    for (const entry of ['i18n', 'prisma', 'resolved-config', 'session', 'trpc']) {
      expect(manifest.exports[`./${entry}`]).toEqual({
        types: `./dist/${entry}.d.ts`,
        import: `./dist/${entry}.js`,
        require: `./dist/${entry}.cjs`,
      });
      expect(manifest.scripts.build).toContain(`src/${entry}.ts`);
    }
  });
});
