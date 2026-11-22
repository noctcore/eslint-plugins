// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-host-concat-path title="path must start with one slash so the host stays fixed"
// ok
const express = require('express');
const app = express();

const APP_ORIGIN = 'https://app.example.com';

app.get('/checkout/done', (req, res) => {
  res.cookie('cart', '', { maxAge: 0 });
  res.set('Referrer-Policy', 'no-referrer');
  const path = String(req.query.path || '/');
  const fixedHost = path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
  const safePath = fixedHost ? path : '/';
  res.redirect(`${APP_ORIGIN}${safePath}`);
});

app.listen(3000);
