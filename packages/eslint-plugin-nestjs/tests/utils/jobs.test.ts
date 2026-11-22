import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ruleTester } from '@noctcore/eslint-test-utils';
import { afterAll, describe, expect, it } from 'vitest';

import { queueRegistrationThroughDefineQueueRule } from '../../src/rules/queue-registration-through-define-queue';
import { JOBS_MODULE, packageDeclares } from '../../src/utils/jobs';

/*
 * A workspace inside a directory whose own package.json declares the jobs
 * package, so the walk's stop at the workspace root is observable:
 *
 *   outer/package.json                      declares @noctcore/jobs
 *   outer/repo/bun.lock                     workspace root marker
 *   outer/repo/package.json                 does not declare it
 *   outer/repo/apps/api/package.json        declares it
 *   outer/repo/apps/api/src/queues/package.json   nested, does not declare it
 *   outer/repo/apps/web/package.json        does not declare it
 */
const outer = mkdtempSync(path.join(tmpdir(), 'nestjs-jobs-workspace-'));
afterAll(() => rmSync(outer, { recursive: true, force: true }));

function manifest(dir: string, dependencies: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: path.basename(dir), dependencies }));
}

const repo = path.join(outer, 'repo');
manifest(outer, { [JOBS_MODULE]: '^0.1.0' });
manifest(repo, { typescript: '^5.0.0' });
writeFileSync(path.join(repo, 'bun.lock'), '{}');
manifest(path.join(repo, 'apps/api'), { [JOBS_MODULE]: '^0.1.0', bullmq: '^6.3.0' });
manifest(path.join(repo, 'apps/api/src/queues'), {});
manifest(path.join(repo, 'apps/web'), { bullmq: '^6.3.0' });
mkdirSync(path.join(repo, 'apps/web/src'), { recursive: true });

const apiFile = path.join(repo, 'apps/api/src/mail.service.ts');
const nestedFile = path.join(repo, 'apps/api/src/queues/mail.queue.ts');
const webFile = path.join(repo, 'apps/web/src/mail.service.ts');
const rootFile = path.join(repo, 'scripts/seed.ts');

describe('packageDeclares', () => {
  it('finds the package in the workspace that declares it', () => {
    expect(packageDeclares(apiFile, repo, JOBS_MODULE)).toBe(true);
  });

  it('walks past a nested package.json that does not declare it', () => {
    expect(packageDeclares(nestedFile, repo, JOBS_MODULE)).toBe(true);
  });

  it('does not see a sibling workspace that declares it', () => {
    expect(packageDeclares(webFile, repo, JOBS_MODULE)).toBe(false);
  });

  it('stops at the workspace root, ignoring a package.json above it', () => {
    expect(packageDeclares(rootFile, repo, JOBS_MODULE)).toBe(false);
  });

  it('resolves a relative filename against cwd', () => {
    expect(packageDeclares('apps/api/src/mail.service.ts', repo, JOBS_MODULE)).toBe(true);
  });
});

const HAND_BUILT = `import { Queue } from 'bullmq';
export const mail = new Queue('mail', { connection });`;

ruleTester.run('queue-registration-through-define-queue (workspace boundary)', queueRegistrationThroughDefineQueueRule, {
  valid: [
    { name: 'a sibling workspace without the package', code: HAND_BUILT, filename: webFile },
    { name: 'a file under a root that only an outer directory declares it in', code: HAND_BUILT, filename: rootFile },
  ],
  invalid: [
    { name: 'the workspace that declares the package', code: HAND_BUILT, filename: apiFile, errors: [{ messageId: 'handBuilt' }] },
    { name: 'under a nested package.json', code: HAND_BUILT, filename: nestedFile, errors: [{ messageId: 'handBuilt' }] },
  ],
});
