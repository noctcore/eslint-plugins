// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-upload-name title="basename of the posted name used when joining"
// ok
const fs = require('node:fs');
const path = require('node:path');
const Koa = require('koa');
const { koaBody } = require('koa-body');

const INBOX = path.resolve('/srv/inbox');
const app = new Koa();
app.use(koaBody());

app.use(async (ctx) => {
  const { name, data } = ctx.request.body;
  const out = path.join(INBOX, path.basename(name));
  await fs.promises.writeFile(out, data);
  ctx.status = 201;
  ctx.body = { saved: true };
});

app.listen(3002);
