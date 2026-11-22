// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-avatar-fetch title="host query must be in the avatar host allowlist and user is encoded"
// ok
const Koa = require('koa');
const Router = require('@koa/router');

const router = new Router();
const AVATAR_HOSTS = ['avatars.example.com', 'img.example.com'];

router.get('/avatar', async (ctx) => {
  const host = String(ctx.query.host);
  const user = encodeURIComponent(String(ctx.query.user));
  if (!AVATAR_HOSTS.includes(host)) ctx.throw(400, 'host not allowed');
  const response = await fetch(`https://${host}/avatars/${user}.png`);
  ctx.type = 'image/png';
  ctx.body = Buffer.from(await response.arrayBuffer());
});

const app = new Koa();
app.use(router.routes());
app.listen(3000);
