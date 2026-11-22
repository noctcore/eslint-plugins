// @bench category=ssrf cwe=CWE-918 framework=express pair=express-feed-reader title="feed reader requests the feed URL from the query with undici"
import express, { Request, Response } from 'express';
import { request } from 'undici';

const app = express();

app.get('/feeds/read', async (req: Request, res: Response) => {
  const feedUrl = String(req.query.feed);
  const { statusCode, body } = await request(feedUrl, { maxRedirections: 2 }); // expect: security/no-user-controlled-fetch-url
  if (statusCode !== 200) {
    return res.status(502).json({ error: 'feed unavailable' });
  }
  const xml = await body.text();
  const items = xml.match(/<item>/g)?.length ?? 0;
  res.json({ items });
});

app.listen(3000);
