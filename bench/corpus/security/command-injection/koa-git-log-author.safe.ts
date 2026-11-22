// @bench category=command-injection cwe=CWE-78 framework=koa pair=koa-git-log-author title="author validated by regex with an early return before concatenation"
// ok
import Koa from 'koa';
import Router from '@koa/router';
import { execSync } from 'node:child_process';

const app = new Koa();
const router = new Router();

router.get('/history', (ctx) => {
  const author = String(ctx.query.author ?? '');
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(author)) {
    ctx.status = 400;
    ctx.body = { error: 'invalid author' };
    return;
  }
  const out = execSync('git log --oneline --author=' + author, { cwd: '/srv/acme/repo', encoding: 'utf8' });
  ctx.body = { commits: out.split('\n').filter(Boolean) };
});

app.use(router.routes());
app.listen(3000);
