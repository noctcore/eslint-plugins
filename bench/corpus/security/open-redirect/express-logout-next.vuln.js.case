// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-logout-next title="logout redirects to the next query value with an explicit 302"
const express = require('express');
const app = express();

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.set('Cache-Control', 'no-store');
    res.redirect(302, req.query.next || '/login'); // expect: security/no-user-controlled-redirect
  });
});

app.listen(3000);
