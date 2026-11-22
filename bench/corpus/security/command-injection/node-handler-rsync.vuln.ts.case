// @bench category=command-injection cwe=CWE-78 framework=node pair=node-handler-rsync title="exported handler interpolates a request target into a promisified exec rsync"
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);

interface SyncRequest {
  body: { target: string };
}

export async function handleSync(req: SyncRequest): Promise<{ ok: boolean }> {
  const target = req.body.target;
  const command = `rsync -az /srv/acme/public/ deploy@mirror.example.com:${target}`;
  await run(command); // expect: security/no-shell-interpolation
  return { ok: true };
}
