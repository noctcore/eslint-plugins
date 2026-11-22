// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-convert-doc title="file name from the body interpolated into execaCommand libreoffice"
const Koa = require('koa');
const { bodyParser } = require('@koa/bodyparser');
const { execaCommand } = require('execa');

const app = new Koa();
app.use(bodyParser());

app.use(async (ctx) => {
  const file = ctx.request.body.file;
  try {
    await execaCommand(`libreoffice --headless --convert-to pdf /srv/docs/${file}`); // expect: security/no-shell-interpolation
    ctx.body = { converted: `${file}.pdf` };
  } catch (err) {
    ctx.status = 500;
    ctx.body = { error: 'conversion failed' };
  }
});

app.listen(3000);
