// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-export-callback title="export job appends the path query to a runtime upstream base"
import Koa from 'koa';
import Router from '@koa/router';

const router = new Router();
const UPSTREAM_BASE = process.env.EXPORT_UPSTREAM ?? 'https://exports.internal.example';

router.get('/exports/fetch', async (ctx) => {
  const path = ctx.query.path as string;
  const response = await fetch(UPSTREAM_BASE + path); // expect: security/no-user-controlled-fetch-url
  ctx.status = response.status;
  ctx.body = await response.text();
});

const app = new Koa();
app.use(router.routes());
app.listen(3000);
