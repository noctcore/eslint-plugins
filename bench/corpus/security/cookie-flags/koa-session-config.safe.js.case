// @bench category=cookie-flags cwe=CWE-614 framework=koa pair=koa-session-config title="koa-session config with secure true"
// ok
const Koa = require('koa');
const session = require('koa-session');

const app = new Koa();
app.keys = [process.env.SESSION_KEY];
app.proxy = true;

const CONFIG = {
  key: 'koa.sess',
  maxAge: 86_400_000,
  httpOnly: true,
  signed: true,
  sameSite: 'lax',
  secure: true,
};

app.use(session(CONFIG, app));

module.exports = app;
