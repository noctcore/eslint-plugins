// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-comment-preview title="comment encoded with he.encode before the preview"
// ok
import express, { Request, Response } from 'express';
import { encode } from 'he';

const app = express();
app.use(express.urlencoded({ extended: false }));

interface PreviewBody {
  comment?: string;
  author?: string;
}

app.post('/comments/preview', (req: Request, res: Response) => {
  const { comment = '', author = 'guest' } = req.body as PreviewBody;
  const stamp = new Date().toISOString();
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(`<section><h3>Preview (${stamp})</h3><blockquote>${encode(comment)}</blockquote></section>`);
});

app.listen(3001);
