// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-report-csv title="query report name concatenated onto the reports base and read"
import fs from 'node:fs/promises';
import Koa from 'koa';

const REPORT_BASE = '/srv/reports/';
const app = new Koa();

app.use(async (ctx) => {
  const report = String(ctx.query.report ?? '');
  const full = REPORT_BASE + report + '.csv'; // expect: security/require-path-containment
  ctx.type = 'text/csv';
  ctx.body = await fs.readFile(full);
});

app.listen(3005);
