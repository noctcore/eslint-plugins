// @bench category=command-injection cwe=CWE-78 framework=node pair=node-http-ps-filter title="user from URL searchParams interpolated into exec ps in a node:http server"
import http from 'node:http';
import { exec } from 'node:child_process';

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = url.searchParams.get('user');
  exec(`ps -u ${user} -o pid,comm`, (error, stdout) => { // expect: security/no-shell-interpolation
    if (error) {
      res.statusCode = 500;
      res.end('ps failed');
      return;
    }
    res.setHeader('content-type', 'text/plain');
    res.end(stdout);
  });
});

server.listen(9100);
