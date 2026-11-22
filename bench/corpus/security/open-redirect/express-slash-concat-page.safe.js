// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-slash-concat-page title="page param limited to a single slug segment"
// ok
const express = require('express');
const app = express();

// Legacy short links: /go?p=pricing used to live at /pricing
app.get('/go', (req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  if (!req.query.p) {
    return res.redirect('/');
  }
  const slug = String(req.query.p);
  if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
    return res.redirect('/');
  }
  res.redirect('/' + slug);
});

app.listen(3000);
