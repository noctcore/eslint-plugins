// @bench category=ssrf cwe=CWE-918 framework=express pair=express-pdf-render title="PDF renderer fetches the page URL from the body with axios config"
import express, { Request, Response } from 'express';
import axios from 'axios';

const app = express();
app.use(express.json());

async function toPdf(html: string): Promise<Buffer> {
  return Buffer.from(html);
}

app.post('/pdf', async (req: Request, res: Response) => {
  const page = req.body.page as string;
  const source = await axios({ url: page, method: 'get', timeout: 8000 }); // expect: security/no-user-controlled-fetch-url
  const pdf = await toPdf(source.data);
  res.type('application/pdf').send(pdf);
});

app.listen(3000);
