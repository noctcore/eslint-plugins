// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-error-handler title="requested path encoded with he.encode"
// ok
import Koa, { Context, Next } from 'koa';
import he from 'he';

const app = new Koa();

async function errorPages(ctx: Context, next: Next): Promise<void> {
  try {
    await next();
    if (ctx.status !== 404) return;
    ctx.status = 404;
    ctx.type = 'text/html';
    ctx.body = `<h1>404</h1><p>Nothing lives at ${he.encode(ctx.path)}</p>`;
  } catch (err) {
    ctx.status = 500;
    ctx.body = 'internal error';
  }
}

app.use(errorPages);
app.listen(4001);
