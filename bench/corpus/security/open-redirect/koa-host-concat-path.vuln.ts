// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-host-concat-path title="path query value concatenated after the app host"
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();
const ORIGIN = 'https://app.example.com';

router.get('/invite/accepted', async (ctx) => {
  await ctx.state.invites.markAccepted(String(ctx.query.token));
  ctx.cookies.set('invite', null);
  ctx.redirect('https://app.example.com' + ctx.query.path); // expect: security/no-user-controlled-redirect
});

app.use(router.routes());
app.listen(3000);
