// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-query-config title="query name interpolated into the config dir path and read"
const fs = require('node:fs/promises');
const Koa = require('koa');

const CONFIG_DIR = '/etc/myservice/conf.d';
const app = new Koa();

app.use(async (ctx) => {
  const name = ctx.query.name;
  const file = `${CONFIG_DIR}/${name}.json`; // expect: security/require-path-containment
  const raw = await fs.readFile(file, 'utf8');
  ctx.body = JSON.parse(raw);
});

app.listen(3001);
