// @bench category=cookie-flags cwe=CWE-1004 framework=node pair=node-serialize-refresh title="cookie package serializes refresh token with shared secure options"
// ok
const http = require('node:http');
const { serialize } = require('cookie');
const { rotate } = require('./tokens');

const AUTH_COOKIE = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };

const server = http.createServer(async (req, res) => {
  if (req.url === '/refresh' && req.method === 'POST') {
    const token = await rotate(req.headers.authorization);
    const header = serialize('refresh_token', token, { ...AUTH_COOKIE, maxAge: 604800 });
    res.setHeader('Set-Cookie', header);
    res.statusCode = 204;
    return res.end();
  }
  res.statusCode = 404;
  res.end();
});

server.listen(3000);
