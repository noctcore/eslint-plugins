// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-login-return-to title="login sends the user to the returnTo query value"
const express = require('express');
const { verifyPassword } = require('./auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const user = await verifyPassword(req.body.email, req.body.password);
  if (!user) return res.status(401).render('login', { error: 'Invalid credentials' });
  req.session.userId = user.id;
  req.log.info({ userId: user.id }, 'login ok');
  res.redirect(req.query.returnTo || '/'); // expect: security/no-user-controlled-redirect
});

module.exports = router;
