// @bench category=ssrf cwe=CWE-918 framework=express pair=express-avatar-import title="zod url schema refined with a hostname allowlist before got runs"
// ok
import express, { Request, Response } from 'express';
import got from 'got';
import { z } from 'zod';

const router = express.Router();
const AVATAR_HOSTS = ['avatars.example.com', 'gravatar.example.com'];

const ImportBody = z.object({
  avatarUrl: z
    .string()
    .url()
    .refine((value) => AVATAR_HOSTS.includes(new URL(value).hostname), 'host not allowed'),
});

router.post('/profile/avatar', async (req: Request, res: Response) => {
  const { avatarUrl } = ImportBody.parse(req.body);
  const image = await got(avatarUrl).buffer();
  if (image.length > 2_000_000) {
    return res.status(413).json({ error: 'image too large' });
  }
  res.json({ bytes: image.length });
});

export default router;
