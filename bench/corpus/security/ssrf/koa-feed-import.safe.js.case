// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-feed-import title="feed URL parsed and matched against the feed host allowlist"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const got = require('got');

const router = new Router();
const FEED_HOSTS = ['feeds.example.com', 'rss.example.com'];

router.post('/feeds/import', async (ctx) => {
  const feedUrl = new URL(ctx.request.body.feedUrl);
  if (feedUrl.protocol !== 'https:' || !FEED_HOSTS.includes(feedUrl.hostname)) {
    ctx.throw(400, 'feed host not allowed');
  }
  const xml = await got(feedUrl, { timeout: { request: 5000 } }).text();
  const entries = xml.split('<entry>').length - 1;
  ctx.status = 201;
  ctx.body = { entries };
});

const app = new Koa();
app.use(bodyParser()).use(router.routes());
app.listen(3000);
