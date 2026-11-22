// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-text-plain title="echo route sends the note as text/html"
import Koa from 'koa';
import Router from '@koa/router';

const app = new Koa();
const router = new Router();

router.get('/echo', (ctx) => {
  const note = String(ctx.query.note ?? '');
  ctx.type = 'text/html; charset=utf-8';
  ctx.set('X-Content-Type-Options', 'nosniff');
  ctx.body = `<p>Your note: ${note}</p>`; // expect: security/require-sanitized-html
});

app.use(router.routes());
app.listen(4005);
