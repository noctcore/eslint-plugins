// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-login-return-to title="returnTo accepted only as a same-site relative path"
// ok
const express = require('express');
const { verifyPassword } = require('./auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const user = await verifyPassword(req.body.email, req.body.password);
  if (!user) return res.status(401).render('login', { error: 'Invalid credentials' });
  req.session.userId = user.id;
  req.log.info({ userId: user.id }, 'login ok');
  const isLocalPath = (p) =>
    typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\');
  const target = isLocalPath(req.query.returnTo) ? req.query.returnTo : '/';
  res.redirect(target);
});

module.exports = router;
