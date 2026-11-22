// @bench category=ssrf cwe=CWE-918 framework=express pair=express-image-proxy title="image proxy streams the src query parameter through axios"
const express = require('express');
const axios = require('axios');

const app = express();

app.get('/img', async (req, res) => {
  const src = req.query.src;
  const upstream = await axios.get(src, { responseType: 'arraybuffer' }); // expect: security/no-user-controlled-fetch-url
  res.set('Content-Type', upstream.headers['content-type']);
  res.set('Cache-Control', 'public, max-age=600');
  res.send(Buffer.from(upstream.data));
});

app.listen(3000);
