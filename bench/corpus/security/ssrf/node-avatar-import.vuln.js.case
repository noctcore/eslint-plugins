// @bench category=ssrf cwe=CWE-918 framework=node pair=node-avatar-import title="avatar import calls axios.get with the href of a URL built from the query"
const http = require('node:http');
const axios = require('axios');

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  const target = new URL(incoming.searchParams.get('avatar'));
  const image = await axios.get(target.href, { responseType: 'arraybuffer' }); // expect: security/no-user-controlled-fetch-url
  res.writeHead(200, { 'Content-Type': image.headers['content-type'] });
  res.end(Buffer.from(image.data));
});

server.listen(3000);
