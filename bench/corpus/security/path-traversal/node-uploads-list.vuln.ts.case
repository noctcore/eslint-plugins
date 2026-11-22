// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-uploads-list title="decoded url path resolved under the files root and read"
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';

const ROOT = resolve('/srv/files');

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = decodeURIComponent(url.pathname.slice(1));
  const full = resolve(ROOT, name); // expect: security/require-path-containment
  try {
    res.end(await readFile(full));
  } catch {
    res.statusCode = 404;
    res.end();
  }
}).listen(8004);
