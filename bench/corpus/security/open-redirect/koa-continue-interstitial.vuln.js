// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-continue-interstitial title="continue page forwards a posted url field to the browser"
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');

const app = new Koa();
const router = new Router();
const ALLOWED_HOSTS = ['partner.example.net', 'docs.example.com'];

router.post('/continue', bodyParser(), async (ctx) => {
  const { url, confirmed } = ctx.request.body;
  if (!confirmed) return ctx.render('continue', { url });
  ctx.redirect(url); // expect: security/no-user-controlled-redirect
});

app.use(router.routes());
app.listen(3000);
