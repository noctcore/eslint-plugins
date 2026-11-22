// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-refresh-rotation title="refresh token cookie rotated with httpOnly false"
const express = require('express');
const { rotateRefreshToken } = require('./tokens');

const router = express.Router();

router.post('/auth/refresh', async (req, res) => {
  const current = req.cookies.refresh_token;
  if (!current) {
    return res.sendStatus(401);
  }
  const next = await rotateRefreshToken(current);
  res.cookie('refresh_token', next.token, {
    httpOnly: false, // expect: security/auth-cookie-flags
    secure: true,
    sameSite: 'strict',
    path: '/auth/refresh',
    maxAge: 7 * 24 * 3600 * 1000,
  });
  res.json({ expiresAt: next.expiresAt });
});

module.exports = router;
