// @bench category=cookie-flags cwe=CWE-1275 framework=express pair=express-connect-sid-samesite title="express-session cookie with sameSite lax and secure"
// ok
const express = require('express');
const session = require('express-session');

const app = express();

const sessionOptions = {
  name: 'connect.sid',
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 12 * 3600 * 1000,
    sameSite: 'lax',
    secure: true,
  },
};

app.use(session(sessionOptions));

app.get('/ping', (req, res) => res.send('pong'));

module.exports = app;
