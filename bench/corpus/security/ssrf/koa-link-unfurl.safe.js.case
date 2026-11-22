// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-link-unfurl title="unfurl url parsed and hostname checked against an allowlist"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const router = new Router();
const ALLOWED_HOSTS = ['news.example.com', 'blog.example.com'];

router.post('/unfurl', async (ctx) => {
  const parsed = new URL(ctx.request.body.url);
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) {
    ctx.throw(400, 'host not allowed');
  }
  const response = await fetch(parsed);
  const html = await response.text();
  ctx.body = { title: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? null };
});

app.use(bodyParser()).use(router.routes());
app.listen(3000);
