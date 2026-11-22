// @bench category=ssrf cwe=CWE-918 framework=koa pair=koa-saved-integration title="saved sync URL revalidated against the host allowlist before the request"
// ok
import Koa from 'koa';
import Router from '@koa/router';
import axios from 'axios';
import { integrations } from './fake-db';

const router = new Router();
const SYNC_HOSTS = ['sync.example.com', 'partners.example.com'];

router.post('/integrations/:id/sync', async (ctx) => {
  const integration = await integrations.get(ctx.params.id);
  if (!integration) ctx.throw(404);
  const syncUrl = new URL(integration.syncUrl);
  if (syncUrl.protocol !== 'https:' || !SYNC_HOSTS.includes(syncUrl.hostname)) {
    ctx.throw(422, 'sync host not allowed');
  }
  const res = await axios.get(syncUrl.href, { headers: { 'x-sync': '1' } });
  ctx.body = { records: res.data.length };
});

const app = new Koa();
app.use(router.routes());
app.listen(3000);
