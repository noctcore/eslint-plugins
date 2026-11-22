// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-locale-back title="locale switcher redirects back to the back query value"
const Koa = require('koa');
const Router = require('@koa/router');

const app = new Koa();
const router = new Router();
const APP_ORIGIN = 'https://app.example.com';
const LOCALES = new Set(['en', 'pl', 'de']);

router.get('/locale/:code', (ctx) => {
  if (!LOCALES.has(ctx.params.code)) ctx.throw(404);
  ctx.cookies.set('locale', ctx.params.code, { maxAge: 31536000000 });
  ctx.redirect(ctx.query.back); // expect: security/no-user-controlled-redirect
});

app.use(router.routes());
app.listen(3000);
