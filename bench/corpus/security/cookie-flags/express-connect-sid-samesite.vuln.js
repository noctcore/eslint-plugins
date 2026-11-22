// @bench category=cookie-flags cwe=CWE-1275 framework=express pair=express-connect-sid-samesite title="express-session cookie with sameSite none and no secure"
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
    sameSite: 'none', // expect: security/auth-cookie-flags
  },
};

app.use(session(sessionOptions));

app.get('/ping', (req, res) => res.send('pong'));

module.exports = app;
