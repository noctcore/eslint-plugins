import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** Writes a throwaway corpus (`{ 'security/demo/x.vuln.js': '...' }`) and returns its root. */
export function writeCorpus(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'noctcore-bench-'));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

export const SHELL_CATEGORY = JSON.stringify({
  title: 'Command injection',
  cwe: 'CWE-78',
  rules: ['security/no-shell-interpolation'],
  overrides: {},
});

export function header(pair: string, title = 'a case'): string {
  return `// @bench category=demo cwe=CWE-78 framework=node pair=${pair} title="${title}"`;
}
