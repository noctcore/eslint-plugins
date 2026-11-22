// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-login-session title="session id cookie set httpOnly, secure and sameSite lax"
// ok
const express = require('express');
const { createSession, verifyPassword } = require('./auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const user = await verifyPassword(req.body.email, req.body.password);
  if (!user) {
    return res.sendStatus(401);
  }
  const sessionId = await createSession(user.id);
  res.cookie('session', sessionId, { maxAge: 86_400_000, httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

module.exports = router;
