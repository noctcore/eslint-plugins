// @bench category=cookie-flags cwe=CWE-1004 framework=koa pair=koa-locale-cookie title="token cookie set with default options on login"
import Router from '@koa/router';
import type { Context } from 'koa';
import { login } from './auth';

const router = new Router();
const SUPPORTED = ['en', 'pl', 'de'];

router.post('/settings/session', async (ctx: Context) => {
  const token: string = await login(ctx.request.body);
  const lang = SUPPORTED.includes(ctx.request.body.lang) ? ctx.request.body.lang : 'en';
  ctx.cookies.set('token', token); // expect: security/auth-cookie-flags
  ctx.body = { ok: true };
});

export default router;
