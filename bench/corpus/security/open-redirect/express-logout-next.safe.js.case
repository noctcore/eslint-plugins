// @bench category=open-redirect cwe=CWE-601 framework=express pair=express-logout-next title="logout next accepted only for allowlisted https hosts"
// ok
const express = require('express');
const app = express();

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.set('Cache-Control', 'no-store');
    const ALLOWED_HOSTS = ['app.example.com', 'docs.example.com'];
    let url;
    try {
      url = new URL(String(req.query.next), 'https://app.example.com');
    } catch {
      url = new URL('/login', 'https://app.example.com');
    }
    const ok = url.protocol === 'https:' && ALLOWED_HOSTS.includes(url.hostname);
    const target = ok ? url.href : '/login';
    res.redirect(302, target);
  });
});

app.listen(3000);
