// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-slash-concat-page title="page param appended to a slash and used as redirect target"
const express = require('express');
const app = express();

// Legacy short links: /go?p=pricing used to live at /pricing
app.get('/go', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  if (!req.query.p) {
    return res.redirect('/');
  }
  res.redirect('/' + req.query.p); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
