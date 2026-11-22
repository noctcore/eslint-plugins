// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-disk-usage title="directory looked up in a map of constant commands"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const { exec } = require('node:child_process');

const app = new Koa();
const router = new Router();

const USAGE_COMMANDS = {
  uploads: 'du -sh /srv/acme/uploads',
  cache: 'du -sh /srv/acme/cache',
  logs: 'du -sh /srv/acme/logs',
};

router.get('/usage/:dir', (ctx) => {
  const cmd = USAGE_COMMANDS[ctx.params.dir];
  if (!Object.hasOwn(USAGE_COMMANDS, ctx.params.dir)) {
    ctx.status = 404;
    return;
  }
  return new Promise((resolve) => {
    exec(cmd, (error, stdout) => {
      ctx.body = error ? { error: 'du failed' } : { usage: stdout.trim() };
      resolve();
    });
  });
});

app.use(router.routes());
app.listen(3000);
