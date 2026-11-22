// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-backup-download title="backup name from the route resolved under the backups dir and streamed"
import { createReadStream } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import Koa from 'koa';
import Router from '@koa/router';

const BACKUPS = resolve('/var/backups/app');
const router = new Router();

router.get('/backups/:name', async (ctx) => {
  const full = resolve(BACKUPS, ctx.params.name); // expect: security/require-path-containment
  ctx.attachment(ctx.params.name);
  ctx.body = createReadStream(full);
});

new Koa().use(router.routes()).listen(3004);
