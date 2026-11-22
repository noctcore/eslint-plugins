// @bench category=cookie-flags cwe=CWE-1004 framework=koa pair=koa-magic-link title="magic link verification sets auth cookie with only overwrite"
const Router = require('@koa/router');
const { verifyMagicToken } = require('./magic');

const router = new Router();

router.get('/magic/verify', async (ctx) => {
  const jwt = await verifyMagicToken(ctx.query.token);
  if (!jwt) {
    ctx.status = 400;
    ctx.body = { error: 'invalid link' };
    return;
  }
  ctx.cookies.set('auth_token', jwt, { maxAge: 7200_000, overwrite: true }); // expect: security/auth-cookie-flags
  ctx.redirect('/');
});

module.exports = router;
