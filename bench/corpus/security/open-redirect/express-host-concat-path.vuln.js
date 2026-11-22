// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-host-concat-path title="path query value appended directly after the app host"
const express = require('express');
const app = express();

const APP_ORIGIN = 'https://app.example.com';

app.get('/checkout/done', (req, res) => {
  res.cookie('cart', '', { maxAge: 0 });
  res.set('Referrer-Policy', 'no-referrer');
  res.redirect(`https://app.example.com${req.query.path}`); // expect: security/no-user-controlled-redirect
});

app.listen(3000);
