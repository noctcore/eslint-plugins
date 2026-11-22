// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-feed-import title="feed import downloads the feed URL in the body with got"
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const got = require('got');

const router = new Router();

router.post('/feeds/import', async (ctx) => {
  const feedUrl = ctx.request.body.feedUrl;
  const xml = await got(feedUrl, { timeout: { request: 5000 } }).text(); // expect: security/no-user-controlled-fetch-url
  const entries = xml.split('<entry>').length - 1;
  ctx.status = 201;
  ctx.body = { entries };
});

const app = new Koa();
app.use(bodyParser()).use(router.routes());
app.listen(3000);
