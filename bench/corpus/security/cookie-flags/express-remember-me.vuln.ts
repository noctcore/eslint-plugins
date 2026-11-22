// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-remember-me title="remember-me cookie with sameSite none and no httpOnly"
import { Router, Request, Response } from 'express';
import { issueRememberToken } from './remember';

const router = Router();
const THIRTY_DAYS = 30 * 24 * 3600 * 1000;

router.post('/login/remember', async (req: Request, res: Response) => {
  const userId: string = req.body.userId;
  const { series, token } = await issueRememberToken(userId);
  res.cookie('remember_me', `${series}:${token}`, { maxAge: THIRTY_DAYS, sameSite: 'none' }); // expect: security/auth-cookie-flags
  res.status(204).end();
});

export default router;
