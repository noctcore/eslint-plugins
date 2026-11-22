// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-config-load title="search param profile interpolated into the profiles dir path and read"
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PROFILES = '/etc/app/profiles';

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const profile = url.searchParams.get('profile') ?? 'default';
  const file = `${PROFILES}/${profile}.json`; // expect: security/require-path-containment
  res.setHeader('content-type', 'application/json');
  res.end(readFileSync(file));
});

server.listen(8003);
