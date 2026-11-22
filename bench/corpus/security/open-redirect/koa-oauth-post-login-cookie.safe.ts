// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-oauth-post-login-cookie title="cookie path checked with an anchored regex after state verification"
// ok
import Koa from 'koa';
import Router from '@koa/router';
import { verifyState, exchangeCode } from './oauth';

const app = new Koa();
const router = new Router();
const PATH_RE = /^\/(?!\/)[a-z0-9/_-]*$/i;

router.get('/oauth/callback', async (ctx) => {
  if (!verifyState(ctx.cookies.get('state'), String(ctx.query.state))) ctx.throw(400, 'bad state');
  const tokens = await exchangeCode(String(ctx.query.code));
  ctx.session!.tokens = tokens;
  const stored = ctx.cookies.get('post_login') ?? '/';
  ctx.redirect(PATH_RE.test(stored) ? stored : '/');
});

app.use(router.routes());
app.listen(3000);
