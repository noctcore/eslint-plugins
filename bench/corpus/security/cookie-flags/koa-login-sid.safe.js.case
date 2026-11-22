// @bench category=cookie-flags cwe=CWE-1004 framework=koa pair=koa-login-sid title="session id cookie set with httpOnly, secure and sameSite"
// ok
const Router = require('@koa/router');
const { createSession, verifyPassword } = require('./auth');

const router = new Router();

router.post('/login', async (ctx) => {
  const { email, password } = ctx.request.body;
  const user = await verifyPassword(email, password);
  if (!user) {
    ctx.status = 401;
    return;
  }
  const id = await createSession(user.id);
  ctx.cookies.set('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  ctx.body = { ok: true };
});

module.exports = router;
