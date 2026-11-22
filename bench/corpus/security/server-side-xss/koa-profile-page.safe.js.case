// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-profile-page title="bio filtered through xss() before rendering"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const xss = require('xss');
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
  ctx.body = `<div class="card"><h2>${xss(member.handle)}</h2><p>${xss(member.bio)}</p></div>`;
});

app.use(router.routes());
app.listen(4002);
