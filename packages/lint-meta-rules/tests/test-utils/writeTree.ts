import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { IMetaCtx } from '@noctcore/harness';

import { createFakeCtx } from './createFakeCtx';

const roots: string[] = [];

/** Remove every tree {@link realTreeCtx} wrote. Call from `afterEach`. */
export function cleanupTrees(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

/**
 * A ctx over `files` that ALSO exist on disk under `ctx.root`. The resolved-config
 * rules hand `ctx.root` to ESLint, which reads the real config files, so a fake
 * map alone would resolve nothing. Reachability through the real harness glob is
 * covered separately by `runLintMetaOnRealTree`.
 */
export function realTreeCtx(files: Readonly<Record<string, string>>): IMetaCtx {
  const root = mkdtempSync(path.join(tmpdir(), 'lint-meta-tree-'));
  roots.push(root);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text, 'utf8');
  }
  return createFakeCtx({ files: { ...files }, root });
}

/**
 * A flat config that turns on `rules` for TS files, declaring a stub plugin for
 * every namespace the ids use so ESLint accepts them.
 */
export function eslintConfigSource(rules: Readonly<Record<string, unknown>>, preamble = ''): string {
  const byPlugin = new Map<string, string[]>();
  for (const ruleId of Object.keys(rules)) {
    const slash = ruleId.lastIndexOf('/');
    if (slash === -1) continue;
    const names = byPlugin.get(ruleId.slice(0, slash)) ?? [];
    names.push(ruleId.slice(slash + 1));
    byPlugin.set(ruleId.slice(0, slash), names);
  }
  const plugins = [...byPlugin]
    .map(
      ([namespace, names]) =>
        `${JSON.stringify(namespace)}: { rules: { ${names
          .map((name) => `${JSON.stringify(name)}: { meta: { schema: false }, create: () => ({}) }`)
          .join(', ')} } }`,
    )
    .join(', ');
  return [
    preamble,
    'export default [',
    `  { files: ['**/*.ts', '**/*.tsx'], plugins: { ${plugins} }, rules: ${JSON.stringify(rules)} },`,
    '];',
    '',
  ].join('\n');
}
