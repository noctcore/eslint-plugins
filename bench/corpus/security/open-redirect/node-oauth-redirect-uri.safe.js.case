// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-oauth-redirect-uri title="redirect_uri compared to a registered set before use"
// ok
const http = require('node:http');
const { issueCode } = require('./oauth');

const REGISTERED = new Set(['https://app.example.com/cb']);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const code = await issueCode(url.searchParams.get('state'));
    if (!REGISTERED.has(redirectUri)) {
      res.writeHead(400);
      return res.end('unknown redirect_uri');
    }
    res.writeHead(302, { Location: `${redirectUri}?code=${code}` });
    res.end();
  })
  .listen(3000);
