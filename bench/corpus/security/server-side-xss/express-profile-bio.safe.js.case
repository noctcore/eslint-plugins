// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-profile-bio title="stored bio cleaned with DOMPurify before rendering"
// ok
const express = require('express');
const DOMPurify = require('isomorphic-dompurify');
const { db } = require('./fake-db');

const app = express();

app.get('/u/:name', async (req, res) => {
  const user = await db.users.findOne({ name: req.params.name });
  if (!user) {
    return res.status(404).send('no such user');
  }
  const bio = user.bio || '';
  const clean = DOMPurify.sanitize(bio);
  const page = `<article><h2>Profile</h2><div class="bio">${clean}</div></article>`;
  res.send(page);
});

app.listen(8080);
