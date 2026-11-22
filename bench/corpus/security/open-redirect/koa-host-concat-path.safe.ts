// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-host-concat-path title="URL parse confirms the origin did not move, then path only"
// ok
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();
const ORIGIN = 'https://app.example.com';

router.get('/invite/accepted', async (ctx) => {
  await ctx.state.invites.markAccepted(String(ctx.query.token));
  ctx.cookies.set('invite', null);
  const url = new URL(String(ctx.query.path || '/'), ORIGIN);
  if (url.origin !== ORIGIN) ctx.throw(400, 'bad path');
  ctx.redirect(url.pathname + url.search);
});

app.use(router.routes());
app.listen(3000);
