// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-oauth-redirect-uri title="redirect_uri must exactly match one registered for the client"
// ok
const express = require('express');
const { issueCode, verifyState } = require('./oauth');

const app = express();
const CLIENTS = new Map([
  ['web', ['https://app.example.com/cb', 'https://admin.example.com/cb']],
]);

app.get('/oauth/authorize', (req, res) => {
  if (!verifyState(req.cookies.state, req.query.state)) return res.sendStatus(400);
  const code = issueCode(req.session.userId, req.query.client_id);
  const registered = CLIENTS.get(String(req.query.client_id)) || [];
  const redirectUri = String(req.query.redirect_uri);
  if (!registered.includes(redirectUri)) return res.sendStatus(400);
  res.redirect(`${redirectUri}?code=${code}&state=${req.query.state}`);
});

app.listen(3000);
