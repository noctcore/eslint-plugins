// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-impersonation title="impersonation session cookie built in a variable without httpOnly"
import { Router, Request, Response, CookieOptions } from 'express';
import { startImpersonation } from './admin';

const router = Router();

router.post('/admin/impersonate/:userId', async (req: Request, res: Response) => {
  const impersonationId = await startImpersonation(req.params.userId);
  const opts: CookieOptions = { secure: true, sameSite: 'strict', maxAge: 900_000 };
  res.cookie('__Host-session', impersonationId, opts); // expect: security/auth-cookie-flags
  res.redirect('/');
});

export default router;
