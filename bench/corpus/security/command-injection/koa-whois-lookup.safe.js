// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-whois-lookup title="domain passed as an argument array to a promisified execFile"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');

const run = promisify(execFile);
const app = new Koa();
const router = new Router();

router.get('/whois', async (ctx) => {
  const domain = ctx.query.domain;
  const { stdout } = await run('whois', [domain]);
  ctx.body = { raw: stdout };
});

app.use(router.routes());
app.listen(3000);
