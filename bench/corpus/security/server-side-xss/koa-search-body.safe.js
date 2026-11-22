// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-search-body title="query escaped with a local escapeHtml helper"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const { searchArticles } = require('./articles');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const app = new Koa();
const router = new Router();

router.get('/search', async (ctx) => {
  const term = String(ctx.query.term || '');
  const hits = await searchArticles(term);
  ctx.type = 'html';
  ctx.body = `<h1>Search: ${escapeHtml(term)}</h1><p>${hits.length} articles found</p>`;
});

app.use(router.routes());
app.listen(4000);
