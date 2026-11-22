// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-webhook-ping title="webhook ping posts to the endpoint URL from the request body"
const Koa = require('koa');
const Router = require('@koa/router');
const bodyParser = require('koa-bodyparser');
const axios = require('axios');

const router = new Router();

router.post('/integrations/ping', async (ctx) => {
  const { endpoint } = ctx.request.body;
  const res = await axios.post(endpoint, { ping: true, at: Date.now() }); // expect: security/no-user-controlled-fetch-url
  ctx.body = { ok: res.status < 300 };
});

const app = new Koa();
app.use(bodyParser()).use(router.routes());
app.listen(3000);
