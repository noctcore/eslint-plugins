// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-static-server title="joined file path checked to stay under the public dir"
// ok
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.resolve(__dirname, 'public');

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  const file = path.join(PUBLIC_DIR, pathname);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.createReadStream(file)
    .on('error', () => res.writeHead(404).end('not found'))
    .pipe(res);
}).listen(8000);
