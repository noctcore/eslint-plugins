// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-oauth-callback-shared title="oauth callback stores access token with shared options lacking httpOnly"
const express = require('express');
const { exchangeCode } = require('./oauth');

const router = express.Router();

const COOKIE_DEFAULTS = {
  path: '/',
  secure: true,
  sameSite: 'lax',
  maxAge: 3600 * 1000,
};

router.get('/oauth/callback', async (req, res) => {
  const tokens = await exchangeCode(req.query.code);
  res.cookie('access_token', tokens.access, { ...COOKIE_DEFAULTS }); // expect: security/auth-cookie-flags
  res.redirect('/dashboard');
});

module.exports = router;
