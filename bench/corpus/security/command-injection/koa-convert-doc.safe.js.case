// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-convert-doc title="file name checked with Set.has before execaCommand libreoffice"
// ok
const Koa = require('koa');
const { bodyParser } = require('@koa/bodyparser');
const { execaCommand } = require('execa');

const app = new Koa();
app.use(bodyParser());

const CONVERTIBLE = new Set(['handbook.docx', 'pricing.docx', 'terms.docx']);

app.use(async (ctx) => {
  const file = ctx.request.body.file;
  if (!CONVERTIBLE.has(file)) {
    ctx.status = 400;
    ctx.body = { error: 'unknown document' };
    return;
  }
  try {
    await execaCommand(`libreoffice --headless --convert-to pdf /srv/docs/${file}`);
    ctx.body = { converted: `${file}.pdf` };
  } catch (err) {
    ctx.status = 500;
    ctx.body = { error: 'conversion failed' };
  }
});

app.listen(3000);
