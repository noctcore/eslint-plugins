// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-logout-set-location title="next resolved through a fixed destination table"
// ok
const Koa = require('koa');
const Router = require('@koa/router');

const app = new Koa();
const router = new Router();
const DESTINATIONS = { home: '/', login: '/login', status: 'https://status.example.com' };

router.post('/logout', (ctx) => {
  ctx.session = null;
  ctx.cookies.set('sid', null);
  ctx.status = 302;
  const key = String(ctx.query.next);
  const destination = Object.hasOwn(DESTINATIONS, key) ? DESTINATIONS[key] : '/login';
  ctx.set('Location', destination);
});

app.use(router.routes());
app.listen(3000);
