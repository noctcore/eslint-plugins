// @bench category=server-side-xss cwe=CWE-79 framework=node pair=node-cheerio-comment title="cheerio fills the comment slot with .html(comment)"
const http = require('node:http');
const cheerio = require('cheerio');

const page = '<html><body><h1>Guestbook</h1><div id="latest"></div></body></html>';

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const comment = url.searchParams.get('comment') || '';
    const $ = cheerio.load(page);
    $('#latest').html(comment); // expect: security/require-sanitized-html
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end($.html());
  })
  .listen(5004);
