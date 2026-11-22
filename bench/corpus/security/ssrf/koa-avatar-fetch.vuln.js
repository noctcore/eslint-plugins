// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-avatar-fetch title="avatar fetch interpolates the host query value into the URL"
const Koa = require('koa');
const Router = require('@koa/router');

const router = new Router();

router.get('/avatar', async (ctx) => {
  const host = ctx.query.host;
  const user = ctx.query.user;
  const response = await fetch(`https://${host}/avatars/${user}.png`); // expect: security/no-user-controlled-fetch-url
  ctx.type = 'image/png';
  ctx.body = Buffer.from(await response.arrayBuffer());
});

const app = new Koa();
app.use(router.routes());
app.listen(3000);
