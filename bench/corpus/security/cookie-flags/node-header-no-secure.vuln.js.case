// @bench category=cookie-flags cwe=CWE-614 framework=node pair=node-header-no-secure title="auth token header cookie without Secure attribute"
const http = require('node:http');
const { consumeLink } = require('./magic');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'https://app.example.test');
  if (url.pathname === '/magic') {
    const jwt = await consumeLink(url.searchParams.get('t'));
    if (!jwt) {
      res.statusCode = 400;
      return res.end('bad link');
    }
    res.setHeader('Set-Cookie', `auth_token=${jwt}; Path=/; HttpOnly; SameSite=Strict`); // expect: security/auth-cookie-flags
    res.writeHead(302, { Location: '/' });
    return res.end();
  }
  res.statusCode = 404;
  res.end();
});

server.listen(3000);
