// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-login-session title="session id cookie written with no flags at login"
const express = require('express');
const { createSession, verifyPassword } = require('./auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const user = await verifyPassword(req.body.email, req.body.password);
  if (!user) {
    return res.sendStatus(401);
  }
  const sessionId = await createSession(user.id);
  res.cookie('session', sessionId, { maxAge: 86_400_000 }); // expect: security/auth-cookie-flags
  res.json({ ok: true });
});

module.exports = router;
