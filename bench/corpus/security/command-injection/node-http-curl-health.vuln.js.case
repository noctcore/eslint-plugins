// @bench category=command-injection cwe=CWE-78 framework=node pair=node-http-curl-health title="x-target header concatenated into execSync curl in a node:http server"
const http = require('node:http');
const { execSync } = require('node:child_process');

const server = http.createServer((req, res) => {
  const target = req.headers['x-target'];
  try {
    const status = execSync('curl -s -o /dev/null -w "%{http_code}" ' + target, { encoding: 'utf8' }); // expect: security/no-shell-interpolation
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ target, status }));
  } catch (err) {
    res.writeHead(502);
    res.end('probe failed');
  }
});

server.listen(8081);
