// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-login-next title="next accepted only as a same-site relative path"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const { verifyPassword } = require('./auth');

const app = new Koa();
const router = new Router();

router.post('/login', async (ctx) => {
  const user = await verifyPassword(ctx.request.body.email, ctx.request.body.password);
  if (!user) ctx.throw(401, 'Invalid credentials');
  ctx.session.userId = user.id;
  const next = ctx.query.next;
  const local = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
  ctx.redirect(local ? next : '/');
});

app.use(router.routes());
app.listen(3000);
