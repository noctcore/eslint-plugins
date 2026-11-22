// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-backup-download title="relative path from the backups dir rejected when dotdot or absolute"
// ok
import { createReadStream } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import Koa from 'koa';
import Router from '@koa/router';

const BACKUPS = resolve('/var/backups/app');
const router = new Router();

router.get('/backups/:name', async (ctx) => {
  const full = resolve(BACKUPS, ctx.params.name);
  const rel = relative(BACKUPS, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    ctx.status = 403;
    return;
  }
  ctx.attachment(ctx.params.name);
  ctx.body = createReadStream(full);
});

new Koa().use(router.routes()).listen(3004);
