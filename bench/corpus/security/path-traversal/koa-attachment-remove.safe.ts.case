// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-attachment-remove title="basename of the query filename used when joining"
// ok
import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import Koa from 'koa';
import Router from '@koa/router';

const ATTACHMENTS = '/srv/attachments';
const router = new Router();

router.delete('/attachments', async (ctx) => {
  const filename = ctx.query.filename as string;
  const target = join(ATTACHMENTS, basename(filename));
  await fs.unlink(target);
  ctx.status = 204;
});

new Koa().use(router.routes()).listen(3006);
