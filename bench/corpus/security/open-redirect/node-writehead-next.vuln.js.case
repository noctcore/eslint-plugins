// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-writehead-next title="writeHead 302 with the next query value as Location"
const http = require('node:http');

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/login/done') {
      res.writeHead(404);
      return res.end('not found');
    }
    const next = url.searchParams.get('next') || '/';
    res.writeHead(302, { Location: next }); // expect: security/no-user-controlled-redirect
    res.end();
  })
  .listen(3000);
