// @bench category=server-side-xss cwe=CWE-79 framework=node pair=node-profile-bio title="bio checked with an anchored regex and rejected otherwise"
// ok
const http = require('node:http');
const { bios } = require('./fake-db');

const SAFE_BIO = /^[\w\s.,'-]{1,200}$/;

http
  .createServer(async (req, res) => {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    if (!id) {
      res.writeHead(400);
      res.end('id required');
      return;
    }
    const bio = await bios.get(id);
    if (!SAFE_BIO.test(bio)) {
      res.writeHead(422, { 'Content-Type': 'text/plain' });
      res.end('bio rejected');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<div class="bio"><h1>About</h1><p>${bio}</p></div>`);
  })
  .listen(5002);
