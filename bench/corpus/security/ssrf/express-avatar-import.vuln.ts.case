// @bench category=ssrf cwe=CWE-918 framework=express pair=express-avatar-import title="avatar import downloads from the avatarUrl in the body"
import express, { Request, Response } from 'express';
import got from 'got';

const router = express.Router();

interface ImportBody {
  avatarUrl: string;
}

router.post('/profile/avatar', async (req: Request<{}, {}, ImportBody>, res: Response) => {
  const { avatarUrl } = req.body;
  const image = await got(avatarUrl).buffer(); // expect: security/no-user-controlled-fetch-url
  if (image.length > 2_000_000) {
    return res.status(413).json({ error: 'image too large' });
  }
  res.json({ bytes: image.length });
});

export default router;
