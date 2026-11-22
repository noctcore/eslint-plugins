// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-asset-send title="resolved asset path checked to stay under the assets dir"
// ok
const fs = require('node:fs');
const path = require('node:path');
const Koa = require('koa');
const Router = require('@koa/router');

const ASSETS = path.resolve(__dirname, 'assets');
const app = new Koa();
const router = new Router();

router.get('/assets/:file', async (ctx) => {
  const full = path.resolve(ASSETS, ctx.params.file);
  if (!full.startsWith(ASSETS + path.sep)) {
    ctx.status = 403;
    return;
  }
  ctx.type = path.extname(full);
  ctx.body = fs.createReadStream(full);
});

app.use(router.routes());
app.listen(3000);
