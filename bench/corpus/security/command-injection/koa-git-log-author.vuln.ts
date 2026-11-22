// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-git-log-author title="author from ctx.query concatenated into an execSync git log"
import Koa from 'koa';
import Router from '@koa/router';
import { execSync } from 'node:child_process';

const app = new Koa();
const router = new Router();

router.get('/history', (ctx) => {
  const author = ctx.query.author as string;
  const out = execSync('git log --oneline --author=' + author, { cwd: '/srv/acme/repo', encoding: 'utf8' }); // expect: security/no-shell-interpolation
  ctx.body = { commits: out.split('\n').filter(Boolean) };
});

app.use(router.routes());
app.listen(3000);
