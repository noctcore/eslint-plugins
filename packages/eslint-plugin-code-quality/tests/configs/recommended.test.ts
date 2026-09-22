import { describe, expect, it } from 'vitest';
import plugin from '../../src/index';

// House policy: a preset rule is `error` or `off`, never `warn`. A warning is a
// rule nobody obeys, so this guards every preset the plugin exports.
function severityOf(entry: unknown): unknown {
  return Array.isArray(entry) ? entry[0] : entry;
}

// Rules the preset leaves out on purpose; `src/configs/recommended.ts` says why.
// A new rule must land in the preset or here, so leaving one out is a decision.
const OMITTED_FROM_PRESETS = [
  'interface-prefix-i',
  'no-template-trim-empty-ternary',
];

describe('presets', () => {
  const presets = Object.entries(plugin.configs) as [string, { rules: Record<string, unknown> }][];

  it('exports at least one preset', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  it.each(presets)('%s ships only error or off', (_name, preset) => {
    const offenders = Object.entries(preset.rules).filter(([, entry]) => {
      const severity = severityOf(entry);
      return severity !== 'error' && severity !== 'off' && severity !== 2 && severity !== 0;
    });
    expect(offenders).toEqual([]);
  });

  it.each(presets)('%s configures or deliberately omits every rule', (_name, preset) => {
    const configured = Object.keys(preset.rules).map((id) => id.slice(id.indexOf('/') + 1));
    const accounted = [...configured, ...OMITTED_FROM_PRESETS].sort();
    expect(accounted).toEqual(Object.keys(plugin.rules).sort());
  });
});
