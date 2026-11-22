// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-writehead-next title="next accepted only as a same-site relative path"
// ok
const http = require('node:http');

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/login/done') {
      res.writeHead(404);
      return res.end('not found');
    }
    const next = url.searchParams.get('next') || '/';
    const local = next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
    const target = local ? next : '/';
    res.writeHead(302, { Location: target });
    res.end();
  })
  .listen(3000);
