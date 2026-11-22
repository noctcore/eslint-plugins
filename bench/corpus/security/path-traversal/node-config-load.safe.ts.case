// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-config-load title="anchored regex limits the profile to a lowercase slug"
// ok
import http from 'node:http';
import { readFileSync } from 'node:fs';

const PROFILES = '/etc/app/profiles';

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const profile = url.searchParams.get('profile') ?? 'default';
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(profile)) {
    res.statusCode = 400;
    res.end('bad profile');
    return;
  }
  const file = `${PROFILES}/${profile}.json`;
  res.setHeader('content-type', 'application/json');
  res.end(readFileSync(file));
});

server.listen(8003);
