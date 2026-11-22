// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-setheader-return-to title="returnTo host checked against an allowlist constant"
// ok
const http = require('node:http');

const ALLOWED_HOSTS = ['app.example.com', 'help.example.com'];

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const returnTo = url.searchParams.get('returnTo') || '/';
  res.statusCode = 302;
  let parsed;
  try {
    parsed = new URL(returnTo, 'https://app.example.com');
  } catch {
    parsed = new URL('/', 'https://app.example.com');
  }
  const ok = parsed.protocol === 'https:' && ALLOWED_HOSTS.includes(parsed.hostname);
  res.setHeader('Location', ok ? parsed.href : '/');
  res.end();
}

http.createServer(handler).listen(3000);
