// @bench category=command-injection cwe=CWE-78 framework=node pair=node-http-ps-filter title="user checked against a const allowlist array before exec ps"
// ok
import http from 'node:http';
import { exec } from 'node:child_process';

const ALLOWED_USERS = ['www-data', 'postgres', 'acme-worker'];

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const user = url.searchParams.get('user') ?? '';
  if (!ALLOWED_USERS.includes(user)) {
    res.statusCode = 403;
    res.end('user not allowed');
    return;
  }
  exec(`ps -u ${user} -o pid,comm`, (error, stdout) => {
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
