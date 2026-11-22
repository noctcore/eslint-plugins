// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-profile-page title="profile route renders stored bio into the page"
const Koa = require('koa');
const Router = require('@koa/router');
const { users } = require('./fake-db');

const app = new Koa();
const router = new Router();

router.get('/members/:handle', async (ctx) => {
  const member = await users.byHandle(ctx.params.handle);
  if (!member) {
    ctx.status = 404;
    return;
  }
  ctx.type = 'html';
  ctx.body = `<div class="card"><h2>${member.handle}</h2><p>${member.bio}</p></div>`; // expect: security/require-sanitized-html
});

app.use(router.routes());
app.listen(4002);
