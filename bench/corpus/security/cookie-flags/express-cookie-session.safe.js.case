// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-cookie-session title="cookie-session middleware with httpOnly true"
// ok
const express = require('express');
const cookieSession = require('cookie-session');

const app = express();

app.use(cookieSession({
  name: 'sid',
  keys: [process.env.COOKIE_KEY_A, process.env.COOKIE_KEY_B],
  maxAge: 24 * 60 * 60 * 1000,
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
}));

app.get('/me', (req, res) => {
  res.json({ userId: req.session.userId ?? null });
});

module.exports = app;
