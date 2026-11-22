// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-oauth-redirect-uri title="OAuth callback redirects the code to the redirect_uri query value"
const express = require('express');
const { issueCode, verifyState } = require('./oauth');

const app = express();
const CLIENTS = new Map([
  ['web', ['https://app.example.com/cb', 'https://admin.example.com/cb']],
]);

app.get('/oauth/authorize', (req, res) => {
  if (!verifyState(req.cookies.state, req.query.state)) return res.sendStatus(400);
  const code = issueCode(req.session.userId, req.query.client_id);
  res.redirect(`${req.query.redirect_uri}?code=${code}&state=${req.query.state}`); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
