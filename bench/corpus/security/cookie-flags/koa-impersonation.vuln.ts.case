// @bench category=cookie-flags cwe=CWE-1275 framework=koa pair=koa-impersonation title="impersonation cookie with sameSite none and no secure"
import Router from '@koa/router';
import type { Context } from 'koa';
import { beginImpersonation } from './admin';

const router = new Router();

router.post('/admin/impersonate', async (ctx: Context) => {
  const id: string = await beginImpersonation(ctx.request.body.userId);
  ctx.cookies.set('session', id, { httpOnly: true, sameSite: 'none', maxAge: 900_000 }); // expect: security/auth-cookie-flags
  ctx.status = 204;
});

export default router;
