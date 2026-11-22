// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-disk-usage title="directory param flows through a command helper into exec"
const Koa = require('koa');
const Router = require('@koa/router');
const { exec } = require('node:child_process');

const app = new Koa();
const router = new Router();

function usageCommand(dir) {
  return 'du -sh /srv/acme/' + dir;
}

router.get('/usage/:dir', (ctx) => {
  const cmd = usageCommand(ctx.params.dir);
  return new Promise((resolve) => {
    exec(cmd, (error, stdout) => { // expect: security/no-shell-interpolation
      ctx.body = error ? { error: 'du failed' } : { usage: stdout.trim() };
      resolve();
    });
  });
});

app.use(router.routes());
app.listen(3000);
