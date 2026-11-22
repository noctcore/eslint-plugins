// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-template-return-to title="template literal wraps the returnTo query value in a redirect"
const express = require('express');
const { exchangeSsoTicket } = require('./sso');

const app = express();

app.get('/sso/complete', async (req, res) => {
  const session = await exchangeSsoTicket(req.query.ticket);
  if (!session) return res.sendStatus(403);
  res.cookie('sid', session.id, { httpOnly: true, sameSite: 'lax' });
  res.redirect(`${req.query.returnTo}`); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
