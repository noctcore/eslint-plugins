// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-npm-view-package title="package name from ctx.params interpolated into spawn with shell true"
import Koa from 'koa';
import Router from '@koa/router';
import { spawn } from 'node:child_process';

const app = new Koa();
const router = new Router();

router.get('/packages/:pkg/version', async (ctx) => {
  const pkg = ctx.params.pkg;
  const output: string = await new Promise((resolve) => {
    const child = spawn(`npm view ${pkg} version`, { shell: true }); // expect: security/no-shell-interpolation
    let data = '';
    child.stdout.on('data', (chunk) => { data += chunk; });
    child.on('close', () => resolve(data.trim()));
  });
  ctx.body = { version: output };
});

app.use(router.routes());
app.listen(3000);
