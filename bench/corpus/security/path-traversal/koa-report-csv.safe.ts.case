// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-report-csv title="anchored regex limits the report name to lowercase word characters"
// ok
import fs from 'node:fs/promises';
import Koa from 'koa';

const REPORT_BASE = '/srv/reports/';
const app = new Koa();

app.use(async (ctx) => {
  const report = String(ctx.query.report ?? '');
  if (!/^[a-z0-9_]{1,40}$/.test(report)) {
    ctx.status = 400;
    return;
  }
  const full = REPORT_BASE + report + '.csv';
  ctx.type = 'text/csv';
  ctx.body = await fs.readFile(full);
});

app.listen(3005);
