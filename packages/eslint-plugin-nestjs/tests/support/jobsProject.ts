import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

/**
 * A throwaway project on disk whose `package.json` declares `dependencies`,
 * for the rules that look for `@noctcore/jobs` in the manifest. Returns the
 * path of a source file inside it; the directory is removed after the suite.
 */
export function projectFile(dependencies: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'nestjs-jobs-'));
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', dependencies }));
  mkdirSync(path.join(dir, 'src'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'src', 'mail.service.ts');
}

/** A source file in a project that depends on `@noctcore/jobs`. */
export const jobsProjectFile = (): string => projectFile({ '@noctcore/jobs': '^0.1.0', bullmq: '^6.3.0' });

/** A source file in a project that uses BullMQ without `@noctcore/jobs`. */
export const bullmqProjectFile = (): string => projectFile({ bullmq: '^6.3.0', '@nestjs/bullmq': '^11.0.0' });
