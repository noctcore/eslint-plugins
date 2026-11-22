// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-login-next title="login sends the user to the next query value"
const Koa = require('koa');
const Router = require('@koa/router');
const { verifyPassword } = require('./auth');

const app = new Koa();
const router = new Router();

router.post('/login', async (ctx) => {
  const user = await verifyPassword(ctx.request.body.email, ctx.request.body.password);
  if (!user) ctx.throw(401, 'Invalid credentials');
  ctx.session.userId = user.id;
  ctx.redirect(ctx.query.next || '/'); // expect: security/no-user-controlled-redirect
});

app.use(router.routes());
app.listen(3000);
