// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-export-callback title="export route maps a report key to a fixed path under the upstream base"
// ok
import Koa from 'koa';
import Router from '@koa/router';

const router = new Router();
const UPSTREAM_BASE = process.env.EXPORT_UPSTREAM ?? 'https://exports.internal.example';
const REPORT_PATHS: Record<string, string> = {
  daily: '/reports/daily.csv',
  weekly: '/reports/weekly.csv',
};

router.get('/exports/fetch', async (ctx) => {
  const path = REPORT_PATHS[ctx.query.report as string];
  if (!path) ctx.throw(404, 'unknown report');
  const response = await fetch(UPSTREAM_BASE + path);
  ctx.status = response.status;
  ctx.body = await response.text();
});

const app = new Koa();
app.use(router.routes());
app.listen(3000);
