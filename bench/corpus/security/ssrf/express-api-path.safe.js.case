// @bench category=ssrf cwe=CWE-918 framework=express pair=express-api-path title="fixed origin with only an encoded id segment from the user"
// ok
const express = require('express');

const app = express();

app.get('/proxy/users/:id', async (req, res) => {
  const id = encodeURIComponent(req.params.id);
  const response = await fetch(`https://api.example.com/users/${id}`);
  const data = await response.json();
  res.status(response.status).json(data);
});

app.listen(3000);
