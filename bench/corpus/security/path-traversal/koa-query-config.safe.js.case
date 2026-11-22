// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-query-config title="config name must be a member of a fixed Set"
// ok
const fs = require('node:fs/promises');
const Koa = require('koa');

const CONFIG_DIR = '/etc/myservice/conf.d';
const app = new Koa();

app.use(async (ctx) => {
  const name = ctx.query.name;
  const names = new Set(['limits', 'features', 'regions']);
  if (!names.has(name)) {
    ctx.throw(404, 'unknown config');
  }
  const file = `${CONFIG_DIR}/${name}.json`;
  const raw = await fs.readFile(file, 'utf8');
  ctx.body = JSON.parse(raw);
});

app.listen(3001);
