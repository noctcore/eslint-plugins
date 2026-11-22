// @bench category=cookie-flags cwe=CWE-1004 framework=node pair=node-theme-header title="theme preference header cookie readable by the client"
// ok
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { startSession } from './auth';

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'https://app.example.test');
  const theme = url.searchParams.get('theme') === 'dark' ? 'dark' : 'light';
  const token: string = await startSession(url.searchParams.get('user') ?? '');
  res.setHeader('Set-Cookie', `theme=${theme}; Path=/; Max-Age=31536000`);
  res.statusCode = 204;
  res.end();
}

createServer(handle).listen(3000);
