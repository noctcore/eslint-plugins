// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-zip-export title="export format chosen by a switch mapping to constant commands"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const { execFile } = require('node:child_process');

const app = new Koa();
const router = new Router();

function scriptFor(format) {
  switch (format) {
    case 'zip':
      return 'cd /srv/exports && zip -r latest.zip ./latest';
    case 'tar':
      return 'cd /srv/exports && tar -czf latest.tgz ./latest';
    default:
      return null;
  }
}

router.post('/export', (ctx) => {
  const script = scriptFor(ctx.request.body.format);
  if (!script) {
    ctx.throw(400, 'unknown format');
  }
  execFile('sh', ['-c', script], (error) => {
    if (error) {
      console.error('export failed', error);
    }
  });
  ctx.body = { queued: true };
});

app.use(router.routes());
app.listen(3000);
