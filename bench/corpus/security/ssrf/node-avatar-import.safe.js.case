// @bench category=ssrf cwe=CWE-918 framework=node pair=node-avatar-import title="avatar URL must be https and resolve to a public address on an allowed host"
// ok
const http = require('node:http');
const axios = require('axios');
const { lookup } = require('node:dns/promises');

const AVATAR_HOSTS = ['avatars.example.com', 'img.example.com'];
const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

const server = http.createServer(async (req, res) => {
  const incoming = new URL(req.url, 'http://localhost');
  const target = new URL(incoming.searchParams.get('avatar') ?? '');
  const { address } = await lookup(target.hostname);
  if (target.protocol !== 'https:' || !AVATAR_HOSTS.includes(target.hostname) || PRIVATE.test(address)) {
    res.writeHead(400).end();
    return;
  }
  const image = await axios.get(target.href, { responseType: 'arraybuffer' });
  res.writeHead(200, { 'Content-Type': image.headers['content-type'] });
  res.end(Buffer.from(image.data));
});

server.listen(3000);
