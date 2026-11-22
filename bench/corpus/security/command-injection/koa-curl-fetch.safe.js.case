// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-curl-fetch title="url escaped with shell-quote before the exec curl call"
// ok
const Koa = require('koa');
const { bodyParser } = require('@koa/bodyparser');
const { exec } = require('node:child_process');
const { quote } = require('shell-quote');

const app = new Koa();
app.use(bodyParser());

app.use(async (ctx) => {
  const { url } = ctx.request.body;
  const command = `curl -sS --max-time 5 ${quote([String(url)])}`;
  const output = await new Promise((resolve, reject) => {
    exec(command, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
  ctx.body = { preview: output.slice(0, 500) };
});

app.listen(3000);
