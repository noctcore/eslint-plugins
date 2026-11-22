// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-setheader-return-to title="setHeader Location from the returnTo query value"
const http = require('node:http');

const ALLOWED_HOSTS = ['app.example.com', 'help.example.com'];

function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const returnTo = url.searchParams.get('returnTo') || '/';
  res.statusCode = 302;
  res.setHeader('Location', returnTo); // expect: security/no-user-controlled-redirect
  res.end();
}

http.createServer(handler).listen(3000);
