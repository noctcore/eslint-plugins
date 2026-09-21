import { afterEach, describe, expect, test } from 'bun:test';

import type { IViolation } from '@noctcore/harness';

import {
  createTenantModelRegistryParityRule,
  parseObjectLiteralKeys,
  type TenantModelRegistryParityOptions,
  type TenantRegistry,
} from '../../src/prisma';
import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';
import { cleanupTrees, eslintConfigSource, realTreeCtx } from '../test-utils/writeTree';

afterEach(cleanupTrees);

/*
 * Deliberately NOT Settly's vocabulary: the scope column is `orgId`, the rules
 * live in an `acme` plugin, and the runtime map is `ORG_SCOPED`. Every one of
 * those is an option, so the rule must work with none of the defaults.
 */
const EXTENSION = 'server/db/org-scope.ts';
const SCHEMA_DIR = 'db/schema';
const CONFIG = 'server/eslint.config.mjs';
const MODEL_RULES = ['acme/scoped-where', 'acme/scoped-write'];
const HAND_RULE = 'acme/scoped-where';

const REGISTRY: TenantRegistry = {
  scopedModels: [],
  unscopedByDesign: { auditEntry: 'pre-auth writes; reads filter orgId by hand' },
  handScopedModels: { auditEntry: ['orgId'] },
};

function extensionSource(models: readonly string[], name = 'ORG_SCOPED'): string {
  const entries = models.map((model) => `  ${model}: ['orgId'], // scope: { nested: 1 }`).join('\n');
  return `/* ORG_SCOPED = { decoy: 1 } */\nexport const ${name}: Record<string, string[]> = {\n${entries}\n};\n`;
}

const model = (name: string, fields: readonly string[] = ['orgId']): string =>
  `model ${name} {\n  id String @id\n${fields.map((field) => `  ${field} String\n`).join('')}}\n`;

function configSource(
  models: readonly string[] | null,
  handScoped: Record<string, readonly string[]> | null = REGISTRY.handScopedModels ?? null,
): string {
  return eslintConfigSource(
    Object.fromEntries(
      MODEL_RULES.map((ruleId) => {
        if (models === null) return [ruleId, 'error'];
        const options: Record<string, unknown> = { orgModels: models };
        if (ruleId === HAND_RULE && handScoped !== null) options.scopeColumns = handScoped;
        return [ruleId, ['error', options]];
      }),
    ),
  );
}

/** Three registries that agree: `invoice` and `project` scoped, `auditEntry` exempt. */
function agreeing(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    [EXTENSION]: extensionSource(['invoice', 'project']),
    [`${SCHEMA_DIR}/billing.prisma`]: model('Invoice') + model('Currency', []),
    [`${SCHEMA_DIR}/nested/work.prisma`]: model('Project') + model('AuditEntry'),
    [CONFIG]: configSource(['invoice', 'project']),
    ...overrides,
  };
}

const OPTIONS: TenantModelRegistryParityOptions = {
  schemaPath: SCHEMA_DIR,
  tenantFields: ['orgId'],
  registry: REGISTRY,
  scopedModelsSource: { file: EXTENSION, exportName: 'ORG_SCOPED' },
  registryFile: 'server/db/registry.ts',
  eslint: {
    cwd: 'server',
    probe: 'src/modules/x.service.ts',
    modelRules: MODEL_RULES,
    modelsOption: 'orgModels',
    handScopedRule: HAND_RULE,
    handScopedOption: 'scopeColumns',
    configFile: CONFIG,
  },
};

async function check(
  files: Record<string, string>,
  options: TenantModelRegistryParityOptions = OPTIONS,
): Promise<IViolation[]> {
  return (await createTenantModelRegistryParityRule(options).runAsync?.(realTreeCtx(files))) ?? [];
}

const messages = (violations: readonly IViolation[]): string[] =>
  violations.map((v) => `${v.file}: ${v.message}`);

describe('tenant-model-registry-parity', () => {
  test('passes when the runtime map, the resolved lint options and the schema agree', async () => {
    expect(await check(agreeing())).toEqual([]);
  });

  test('a new tenant-bearing schema model that neither registry knows is reported', async () => {
    const violations = await check(
      agreeing({ [`${SCHEMA_DIR}/billing.prisma`]: model('Invoice') + model('Payslip') }),
    );
    expect(messages(violations)).toEqual([
      expect.stringMatching(/^server\/db\/org-scope\.ts: `payslip` carries orgId in the Prisma schema but is neither/u),
    ]);
  });

  test('a model scoped at runtime but missing from a rule is reported once per rule', async () => {
    const violations = await check(agreeing({ [CONFIG]: configSource(['invoice']) }));
    expect(messages(violations)).toEqual(
      MODEL_RULES.map((ruleId) =>
        expect.stringContaining(`\`project\` is tenant-scoped at runtime but is MISSING from the \`orgModels\` option of "${ruleId}"`),
      ),
    );
    expect(violations.every((v) => v.file === CONFIG)).toBe(true);
  });

  test('a model the rules police but the runtime does not scope is reported', async () => {
    const violations = await check(
      agreeing({ [CONFIG]: configSource(['invoice', 'project', 'currency']) }),
    );
    expect(violations).toHaveLength(MODEL_RULES.length);
    expect(violations[0]?.message).toMatch(/`currency` is in the `orgModels` option .* but is not tenant-scoped at runtime/u);
  });

  test('a scoped model the schema does not bear, and a stale exemption, are reported', async () => {
    const violations = await check(
      agreeing({
        [EXTENSION]: extensionSource(['invoice', 'project', 'ghost']),
        [CONFIG]: configSource(['invoice', 'project', 'ghost']),
        [`${SCHEMA_DIR}/nested/work.prisma`]: model('Project'),
      }),
    );
    expect(messages(violations)).toEqual([
      expect.stringContaining('`auditEntry` is listed as unscoped by design but no schema model'),
      expect.stringContaining('`ghost` is isolated by the tenant-scope extension but no schema model'),
    ]);
  });

  test('a rule that resolves with no model option, or off, is reported', async () => {
    const noOption = await check(agreeing({ [CONFIG]: configSource(null) }));
    expect(noOption.map((v) => v.message)).toEqual([
      ...MODEL_RULES.map((ruleId) => expect.stringContaining(`"${ruleId}" resolves with no \`orgModels\` option`)),
      expect.stringContaining(`"${HAND_RULE}" resolves with no \`scopeColumns\` option`),
    ]);

    const off = await check(
      agreeing({ [CONFIG]: configSource(['invoice', 'project']).replace(/"error"/gu, '"off"') }),
    );
    expect(off.map((v) => v.message).filter((m) => m.includes('is off'))).toHaveLength(MODEL_RULES.length);
  });

  test('a hand-written copy of the hand-scope map is reported', async () => {
    const violations = await check(
      agreeing({ [CONFIG]: configSource(['invoice', 'project'], { auditEntry: ['orgId', 'userId'] }) }),
    );
    expect(messages(violations)).toEqual([
      expect.stringContaining('resolves to does not match the registry (resolved: auditEntry:orgId+userId; expected: auditEntry:orgId)'),
    ]);
  });

  test('every exemption must name its hand-scope columns or why it has none', async () => {
    const registry: TenantRegistry = {
      scopedModels: [],
      unscopedByDesign: { auditEntry: 'reason' },
      handScopedModels: { project: ['orgId'] },
      handScopePending: { invoice: 'stale note' },
    };
    const violations = await check(agreeing(), { ...OPTIONS, registry, eslint: false });
    expect(messages(violations)).toEqual([
      expect.stringMatching(/^server\/db\/registry\.ts: `auditEntry` is exempt .* has no `handScopedModels` entry/u),
      expect.stringMatching(/^server\/db\/registry\.ts: `project` has a `handScopedModels` entry but is not exempt/u),
      expect.stringMatching(/^server\/db\/registry\.ts: `invoice` is recorded in `handScopePending` but is not exempt/u),
    ]);

    expect(
      await check(agreeing(), { ...OPTIONS, registry, eslint: false, requireHandScope: false }),
    ).toEqual([]);
  });

  test('scopedModels can be injected instead of read from source', async () => {
    const options: TenantModelRegistryParityOptions = {
      ...OPTIONS,
      scopedModelsSource: undefined,
      registry: { ...REGISTRY, scopedModels: ['invoice', 'project'] },
    };
    expect(await check(agreeing(), options)).toEqual([]);
    const violations = await check(agreeing(), {
      ...options,
      registry: { ...REGISTRY, scopedModels: ['invoice'] },
    });
    expect(violations[0]?.file).toBe('server/db/registry.ts');
    expect(violations[0]?.message).toMatch(/`project` carries orgId/u);
  });

  test('fails closed on an unreadable runtime map', async () => {
    const violations = await check(agreeing({ [EXTENSION]: extensionSource(['invoice'], 'RENAMED') }));
    expect(messages(violations)).toEqual([
      expect.stringMatching(/^server\/db\/org-scope\.ts: Could not read the `ORG_SCOPED` object literal/u),
    ]);
  });

  test('fails closed on a missing schema, and still checks the config', async () => {
    const violations = await check(agreeing(), { ...OPTIONS, schemaPath: 'nowhere/schema.prisma' });
    expect(messages(violations)).toEqual([
      expect.stringMatching(/^nowhere\/schema\.prisma: Could not read a Prisma schema/u),
    ]);
  });

  test('fails closed on an unresolvable config, keeping the schema findings', async () => {
    const violations = await check(
      agreeing({
        [CONFIG]: "import 'no-such-package-anywhere';\nexport default [];\n",
        [`${SCHEMA_DIR}/billing.prisma`]: model('Invoice') + model('Payslip'),
      }),
    );
    expect(violations.map((v) => v.message)).toEqual([
      expect.stringContaining('`payslip` carries orgId'),
      expect.stringContaining('Could not resolve the effective ESLint config for "server"'),
    ]);
  });

  test('reads a single schema file as well as a folder', async () => {
    const files = { ...agreeing(), 'db/one.prisma': model('Invoice') + model('Project') + model('AuditEntry') };
    expect(await check(files, { ...OPTIONS, schemaPath: 'db/one.prisma' })).toEqual([]);
  });

  test('defaults: a default-constructed rule fails closed rather than passing an empty repo', async () => {
    const violations = await check({});
    const rule = createTenantModelRegistryParityRule();
    expect(rule.id).toBe('tenant-model-registry-parity');
    expect(rule.run).toBeUndefined();
    const defaults = (await rule.runAsync?.(realTreeCtx({}))) ?? [];
    expect(defaults.map((v) => v.file)).toEqual(['prisma/schema.prisma', '.']);
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe('parseObjectLiteralKeys', () => {
  test('reads top-level identifier keys, skipping nested objects, comments and strings', () => {
    const source = `
      // export const MAP = { commented: 1 }
      const note = "MAP = { inString: 1 }";
      export const MAP = {
        alpha: ['a', 'b:c'],
        beta: { nested: 1, deeper: { x: [1, 2] } },
        /* gamma: skipped */
        delta: fn({ inner: 1 }),
      } as const;
    `;
    expect(parseObjectLiteralKeys(source, 'MAP')).toEqual(['alpha', 'beta', 'delta']);
  });

  test('null when the declaration is absent or unterminated', () => {
    expect(parseObjectLiteralKeys('export const OTHER = {};', 'MAP')).toBeNull();
    expect(parseObjectLiteralKeys('export const MAP = { a: 1,', 'MAP')).toBeNull();
  });
});

describe('tenant-model-registry-parity through the real harness', () => {
  const files = agreeing({ [`${SCHEMA_DIR}/billing.prisma`]: model('Invoice') + model('Payslip') });
  const expected = [
    'tenant-model-registry-parity (server/db/org-scope.ts): `payslip` carries orgId in the Prisma schema',
  ];
  const summarise = (lines: readonly string[]): string[] =>
    lines.map((line) => line.split(' but is neither')[0] ?? line);

  test('under Bun, from source (the real glob reaches a nested schema folder)', () => {
    const run = runLintMetaOnRealTree(files, 'createTenantModelRegistryParityRule', OPTIONS);
    expect(summarise(run.violations)).toEqual(expected);
    expect(run.code).toBe(1);
  }, 60_000);

  test('under Node with ESLint 9.0.0 (the peer floor), from the built package', () => {
    const run = runLintMetaOnRealTree(files, 'createTenantModelRegistryParityRule', OPTIONS, {
      runtime: 'node-eslint9',
    });
    expect(run.stdout).toMatch(/^eslint 9\.0\.0$/mu);
    expect(summarise(run.violations)).toEqual(expected);
    expect(run.code).toBe(1);
  }, 60_000);

  test('a clean tree passes through the real harness', () => {
    const run = runLintMetaOnRealTree(agreeing(), 'createTenantModelRegistryParityRule', OPTIONS);
    expect(run.violations).toEqual([]);
    expect(run.code).toBe(0);
  }, 60_000);
});
