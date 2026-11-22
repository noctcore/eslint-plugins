// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-npm-view-package title="package name validated by regex, then interpolated into spawn with shell"
// ok
import Koa from 'koa';
import Router from '@koa/router';
import { spawn } from 'node:child_process';

const app = new Koa();
const router = new Router();
const PACKAGE_NAME = /^(?:@[a-z0-9-]{1,40}\/)?[a-z0-9][a-z0-9._-]{0,60}$/;

router.get('/packages/:pkg/version', async (ctx) => {
  const pkg = ctx.params.pkg;
  if (!PACKAGE_NAME.test(pkg)) {
    ctx.status = 400;
    return;
  }
  const output: string = await new Promise((resolve) => {
    const child = spawn(`npm view ${pkg} version`, { shell: true });
    let data = '';
    child.stdout.on('data', (chunk) => { data += chunk; });
    child.on('close', () => resolve(data.trim()));
  });
  ctx.body = { version: output };
});

app.use(router.routes());
app.listen(3000);
