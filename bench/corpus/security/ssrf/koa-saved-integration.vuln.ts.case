// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-saved-integration title="saved integration URL is loaded from the db and requested"
import Koa from 'koa';
import Router from '@koa/router';
import axios from 'axios';
import { integrations } from './fake-db';

const router = new Router();

router.post('/integrations/:id/sync', async (ctx) => {
  const integration = await integrations.get(ctx.params.id);
  if (!integration) ctx.throw(404);
  const res = await axios.get(integration.syncUrl, { headers: { 'x-sync': '1' } }); // expect: security/no-user-controlled-fetch-url
  ctx.body = { records: res.data.length };
});

const app = new Koa();
app.use(router.routes());
app.listen(3000);
