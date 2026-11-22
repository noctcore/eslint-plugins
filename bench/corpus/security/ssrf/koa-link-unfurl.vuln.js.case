// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-link-unfurl title="unfurl fetches the url field of the koa request body"
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const router = new Router();

router.post('/unfurl', async (ctx) => {
  const { url } = ctx.request.body;
  const response = await fetch(url); // expect: security/no-user-controlled-fetch-url
  const html = await response.text();
  ctx.body = { title: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? null };
});

app.use(bodyParser()).use(router.routes());
app.listen(3000);
