// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-route-map title="pathname looked up in a fixed route table of page files"
// ok
const http = require('node:http');
const fs = require('node:fs');

const PAGES = '/srv/site/pages';
const ROUTES = { '/': 'index.html', '/about': 'about.html', '/pricing': 'pricing.html' };

http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const name = Object.prototype.hasOwnProperty.call(ROUTES, pathname) ? ROUTES[pathname] : null;
  if (!name) {
    res.writeHead(404).end('no such page');
    return;
  }
  const file = `${PAGES}/${name}`;
  fs.readFile(file, 'utf8', (err, html) => {
    res.writeHead(err ? 500 : 200, { 'content-type': 'text/html' });
    res.end(err ? 'error' : html);
  });
}).listen(8002);
