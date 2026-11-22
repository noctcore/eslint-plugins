// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-webhook-ping title="endpoint hostname looked up in a Set of registered receivers"
// ok
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const axios = require('axios');

const router = new Router();
const RECEIVERS = new Set(['hooks.example.com', 'ingest.example.com']);

router.post('/integrations/ping', async (ctx) => {
  const endpoint = new URL(ctx.request.body.endpoint);
  if (endpoint.protocol !== 'https:' || !RECEIVERS.has(endpoint.hostname)) {
    ctx.throw(400, 'receiver not allowed');
  }
  const res = await axios.post(endpoint.href, { ping: true, at: Date.now() });
  ctx.body = { ok: res.status < 300 };
});

const app = new Koa();
app.use(bodyParser()).use(router.routes());
app.listen(3000);
