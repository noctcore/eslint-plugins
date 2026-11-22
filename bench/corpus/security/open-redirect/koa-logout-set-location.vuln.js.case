// @bench category=open-redirect cwe=CWE-601 framework=koa pair=koa-logout-set-location title="logout sets the Location header from the next query value"
const Koa = require('koa');
const Router = require('@koa/router');

const app = new Koa();
const router = new Router();
const DESTINATIONS = { home: '/', login: '/login', status: 'https://status.example.com' };

router.post('/logout', (ctx) => {
  ctx.session = null;
  ctx.cookies.set('sid', null);
  ctx.status = 302;
  ctx.set('Location', ctx.query.next || '/login'); // expect: security/no-user-controlled-redirect
});

app.use(router.routes());
app.listen(3000);
