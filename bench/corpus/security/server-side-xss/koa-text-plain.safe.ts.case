// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-text-plain title="echo route sends the note as text/plain"
// ok
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();

router.get('/echo', (ctx) => {
  const note = String(ctx.query.note ?? '');
  ctx.type = 'text/plain; charset=utf-8';
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.body = `Your note: ${note}`;
});

app.use(router.routes());
app.listen(4005);
