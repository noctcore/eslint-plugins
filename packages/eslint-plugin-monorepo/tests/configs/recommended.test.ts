import { describe, expect, it } from 'vitest';
import plugin from '../../src/index';

// House policy: a preset rule is `error` or `off`, never `warn`. A warning is a
// rule nobody obeys, so this guards every preset the plugin exports.
function severityOf(entry: unknown): unknown {
  return Array.isArray(entry) ? entry[0] : entry;
}

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

  it.each(presets)('%s configures every rule the plugin ships', (_name, preset) => {
    const configured = Object.keys(preset.rules).map((id) => id.slice(id.indexOf('/') + 1));
    expect(configured.sort()).toEqual(Object.keys(plugin.rules).sort());
  });
});
