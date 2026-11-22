// @bench category=command-injection cwe=CWE-78 framework=node pair=node-handler-rsync title="request target escaped with shell-quote before the promisified exec rsync"
// ok
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { quote } from 'shell-quote';

const run = promisify(exec);

interface SyncRequest {
  body: { target: string };
}

export async function handleSync(req: SyncRequest): Promise<{ ok: boolean }> {
  const target = req.body.target;
  const command = `rsync -az /srv/acme/public/ ${quote([`deploy@mirror.example.com:${target}`])}`;
  await run(command);
  return { ok: true };
}
