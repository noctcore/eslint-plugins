// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-zip-export title="file name from the body built into an execFile sh -c script"
const Koa = require('koa');
const Router = require('@koa/router');
const { execFile } = require('node:child_process');

const app = new Koa();
const router = new Router();

router.post('/export', (ctx) => {
  const name = ctx.request.body.name;
  const script = `cd /srv/exports && zip -r ${name}.zip ./${name}`;
  execFile('sh', ['-c', script], (error) => { // expect: security/no-shell-interpolation
    if (error) {
      ctx.throw(500, 'export failed');
    }
  });
  ctx.body = { queued: true };
});

app.use(router.routes());
app.listen(3000);
