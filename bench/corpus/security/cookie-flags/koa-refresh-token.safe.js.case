// @bench category=cookie-flags cwe=CWE-1004 framework=koa pair=koa-refresh-token title="refresh token cookie set with httpOnly true"
// ok
const Router = require('@koa/router');
const { rotate } = require('./tokens');

const router = new Router();

router.post('/refresh', async (ctx) => {
  const old = ctx.cookies.get('refresh_token');
  if (!old) {
    ctx.throw(401);
  }
  const fresh = await rotate(old);
  ctx.cookies.set('refresh_token', fresh, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: 604_800_000,
  });
  ctx.status = 204;
});

module.exports = router;
