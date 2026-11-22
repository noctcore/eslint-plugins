// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-image-proxy title="src hostname matched by an anchored regex on the CDN domain"
// ok
import Koa from 'koa';
import Router from '@koa/router';
import fetch from 'node-fetch';

const app = new Koa();
const router = new Router();
const CDN_HOST = /^[a-z0-9-]+\.cdn\.example\.com$/;

router.get('/image', async (ctx) => {
  const src = new URL(ctx.query.src as string);
  if (src.protocol !== 'https:' || !CDN_HOST.test(src.hostname)) {
    ctx.throw(403, 'host not allowed');
  }
  const upstream = await fetch(src.href);
  ctx.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
  ctx.body = Buffer.from(await upstream.arrayBuffer());
});

app.use(router.routes());
app.listen(3000);
