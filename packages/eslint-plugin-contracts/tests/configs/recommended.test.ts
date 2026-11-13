import { describe, expect, it } from 'vitest';
import plugin from '../../src/index';

// House policy: a preset rule is `error` or `off`, never `warn`. A warning is a
// rule nobody obeys, so this guards every preset the plugin exports.
function severityOf(entry: unknown): unknown {
  return Array.isArray(entry) ? entry[0] : entry;
}

// Rules the preset leaves out on purpose; `src/configs/recommended.ts` says why.
// A new rule must land in the preset or here, so leaving one out is a decision.
// Every rule that needs options (`meta.docs.requiresOptions`) must be here.
const OMITTED_FROM_PRESETS: readonly string[] = [
  'describe-auth-matches-middleware',
  'env-var-schema-parity',
  'require-registered-keys',
  'restrict-throw-to-taxonomy',
  'route-handler-order',
  'translation-key-exists',
  'zod-field-describe',
];

type Preset = { name?: string; rules: Record<string, unknown> };
type RuleMeta = { meta?: { docs?: { requiresOptions?: boolean } } };

// The house rules only `strict` turns on; `src/configs/strict.ts` says why.
const STRICT_ONLY: readonly string[] = [
  'noctcore-contracts/wire-message-naming',
  'noctcore-contracts/zod-schema-naming',
];

describe('presets', () => {
  const presets = Object.entries(plugin.configs) as [string, Preset][];
  const recommended = plugin.configs.recommended as Preset;
  const strict = plugin.configs.strict as Preset;

  it('exports at least one preset', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  it.each(presets)('%s is named after the plugin and the preset', (name, preset) => {
    expect(preset.name).toBe(`noctcore-contracts/${name}`);
  });

  it.each(presets)('%s ships only error or off', (_name, preset) => {
    const offenders = Object.entries(preset.rules).filter(([, entry]) => {
      const severity = severityOf(entry);
      return severity !== 'error' && severity !== 'off' && severity !== 2 && severity !== 0;
    });
    expect(offenders).toEqual([]);
  });

  it('strict configures or deliberately omits every rule', () => {
    const configured = Object.keys(strict.rules).map((id) => id.slice(id.indexOf('/') + 1));
    const accounted = [...configured, ...OMITTED_FROM_PRESETS].sort();
    expect(accounted).toEqual(Object.keys(plugin.rules).sort());
  });

  it('strict keeps every recommended entry at the same severity', () => {
    expect(strict.rules).toMatchObject(recommended.rules);
  });

  it('recommended leaves out the house rules strict adds', () => {
    expect(Object.keys(recommended.rules).filter((id) => STRICT_ONLY.includes(id))).toEqual([]);
    expect(Object.keys(strict.rules).filter((id) => !(id in recommended.rules)).sort()).toEqual(STRICT_ONLY);
  });

  it('leaves out every rule that needs options', () => {
    const needsOptions = Object.entries(plugin.rules as Record<string, RuleMeta>)
      .filter(([, rule]) => rule.meta?.docs?.requiresOptions === true)
      .map(([id]) => id);
    expect(OMITTED_FROM_PRESETS).toEqual(expect.arrayContaining(needsOptions));
  });

  it('leaves restrict-throw-to-taxonomy out until `allow` names the project errors', () => {
    expect((plugin.configs.recommended as Preset).rules).not.toHaveProperty('noctcore-contracts/restrict-throw-to-taxonomy');
  });
});
