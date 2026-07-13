import { describe, expect, test } from 'bun:test';

import { createNoWarnSeverityRule } from '../../src/rules/no-warn-severity';
import { createFakeCtx } from '../test-utils/createFakeCtx';

describe('no-warn-severity', () => {
  const rule = createNoWarnSeverityRule();

  test('flags a single-quoted warn severity, with a line number', () => {
    const ctx = createFakeCtx({
      files: { 'eslint.config.mjs': "export default [\n  { rules: { 'x': 'warn' } },\n];\n" },
    });
    const v = rule.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.line).toBe(2);
    expect(v[0]?.file).toBe('eslint.config.mjs');
  });

  test('flags a double-quoted warn severity', () => {
    const ctx = createFakeCtx({ files: { 'eslint.config.mjs': 'x: "warn"' } });
    expect(rule.run(ctx)).toHaveLength(1);
  });

  test('ignores a warn literal inside a line comment', () => {
    const ctx = createFakeCtx({
      files: { 'eslint.config.mjs': "// keep 'warn' here as a note\nrules: { x: 'error' }" },
    });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test("passes when only 'error'/'off' are used", () => {
    const ctx = createFakeCtx({ files: { 'eslint.config.mjs': "a: 'error'\nb: 'off'" } });
    expect(rule.run(ctx)).toHaveLength(0);
  });

  test('is a no-op when no config file exists', () => {
    expect(rule.run(createFakeCtx())).toHaveLength(0);
  });

  test('honors a custom configFiles list', () => {
    const custom = createNoWarnSeverityRule({ configFiles: ['eslint.config.ts'] });
    const ctx = createFakeCtx({
      files: { 'eslint.config.mjs': "a: 'warn'", 'eslint.config.ts': "b: 'warn'" },
    });
    const v = custom.run(ctx);
    expect(v).toHaveLength(1);
    expect(v[0]?.file).toBe('eslint.config.ts');
  });

  test('ciCritical defaults true and is overridable', () => {
    expect(createNoWarnSeverityRule().ciCritical).toBe(true);
    expect(createNoWarnSeverityRule({ ciCritical: false }).ciCritical).toBe(false);
  });
});
