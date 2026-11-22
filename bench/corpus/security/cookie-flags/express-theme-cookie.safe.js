// @bench category=cookie-flags cwe=CWE-1004 framework=express pair=express-theme-cookie title="theme preference cookie set client readable with no flags"
// ok
const express = require('express');
const { signIn } = require('./auth');

const router = express.Router();

router.post('/preferences', express.json(), async (req, res) => {
  const user = await signIn(req);
  if (!user) {
    return res.sendStatus(401);
  }
  const token = await user.issueToken();
  const theme = req.body.theme === 'dark' ? 'dark' : 'light';
  res.cookie('theme', theme, { maxAge: 365 * 24 * 3600 * 1000 });
  res.json({ saved: true });
});

module.exports = router;
