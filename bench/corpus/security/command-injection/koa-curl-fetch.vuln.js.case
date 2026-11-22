// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-curl-fetch title="url from the request body interpolated into an exec curl call"
const Koa = require('koa');
const { bodyParser } = require('@koa/bodyparser');
const { exec } = require('node:child_process');

const app = new Koa();
app.use(bodyParser());

app.use(async (ctx) => {
  const { url } = ctx.request.body;
  const output = await new Promise((resolve, reject) => {
    exec(`curl -sS --max-time 5 ${url}`, (err, stdout) => (err ? reject(err) : resolve(stdout))); // expect: security/no-shell-interpolation
  });
  ctx.body = { preview: output.slice(0, 500) };
});

app.listen(3000);
