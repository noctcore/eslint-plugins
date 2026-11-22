// @bench category=command-injection cwe=CWE-78 framework=node pair=node-http-nslookup title="domain from URL searchParams interpolated into exec in a node:http server"
const http = require('node:http');
const { exec } = require('node:child_process');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const domain = url.searchParams.get('domain');
  exec(`nslookup ${domain}`, (error, stdout) => { // expect: security/no-shell-interpolation
    if (error) {
      res.writeHead(500);
      res.end('lookup failed');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(stdout);
  });
});

server.listen(8080);
