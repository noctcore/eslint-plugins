// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-continue-interstitial title="forwarded url must use https and an allowlisted host"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const router = new Router();
const ALLOWED_HOSTS = ['partner.example.net', 'docs.example.com'];

router.post('/continue', bodyParser(), async (ctx) => {
  const { url, confirmed } = ctx.request.body;
  if (!confirmed) return ctx.render('continue', { url });
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    ctx.throw(400, 'invalid url');
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.includes(parsed.hostname)) ctx.throw(400, 'host not allowed');
  ctx.redirect(parsed.href);
});

app.use(router.routes());
app.listen(3000);
