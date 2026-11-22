// @bench category=cookie-flags cwe=CWE-1004 framework=node pair=node-header-session title="set-cookie header with session token, HttpOnly, Secure and SameSite"
// ok
const http = require('node:http');
const { authenticate, newSession } = require('./auth');

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/login') {
    const user = await authenticate(req);
    if (!user) {
      res.statusCode = 401;
      return res.end();
    }
    const token = await newSession(user.id);
    res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    res.statusCode = 204;
    return res.end();
  }
  res.statusCode = 404;
  res.end();
});

server.listen(3000);
