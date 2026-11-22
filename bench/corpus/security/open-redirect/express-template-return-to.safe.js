// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-template-return-to title="returnTo checked by an anchored path regex before the redirect"
// ok
const express = require('express');
const { exchangeSsoTicket } = require('./sso');

const app = express();

app.get('/sso/complete', async (req, res) => {
  const session = await exchangeSsoTicket(req.query.ticket);
  if (!session) return res.sendStatus(403);
  res.cookie('sid', session.id, { httpOnly: true, sameSite: 'lax' });
  const PATH_RE = /^\/(?!\/)[a-z0-9/_-]*$/i;
  const requested = String(req.query.returnTo || '');
  const target = PATH_RE.test(requested) ? requested : '/';
  res.redirect(`${target}`);
});

app.listen(3000);
