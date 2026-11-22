// @bench category=open-redirect cwe=CWE-601 framework=node pair=node-oauth-redirect-uri title="OAuth step 302s the code to the redirect_uri query value"
const http = require('node:http');
const { issueCode } = require('./oauth');

const REGISTERED = new Set(['https://app.example.com/cb']);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const redirectUri = url.searchParams.get('redirect_uri') || '';
    const code = await issueCode(url.searchParams.get('state'));
    res.writeHead(302, { Location: `${redirectUri}?code=${code}` }); // expect: security/no-user-controlled-redirect
    res.end();
  })
  .listen(3000);
