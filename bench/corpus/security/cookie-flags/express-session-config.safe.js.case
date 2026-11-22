// @bench category=cookie-flags cwe=CWE-614 framework=express pair=express-session-config title="express-session cookie config with secure true behind a proxy"
// ok
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { redisClient } = require('./redis');

const app = express();
app.set('trust proxy', 1);

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  name: 'connect.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 8,
  },
}));

module.exports = app;
