// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-image-proxy title="image proxy passes the src query value to node-fetch"
import Koa from 'koa';
import Router from '@koa/router';
import fetch from 'node-fetch';

const app = new Koa();
const router = new Router();

router.get('/image', async (ctx) => {
  const src = ctx.query.src as string;
  const upstream = await fetch(src); // expect: security/no-user-controlled-fetch-url
  ctx.set('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg');
  ctx.body = Buffer.from(await upstream.arrayBuffer());
});

app.use(router.routes());
app.listen(3000);
