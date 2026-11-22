// @bench category=ssrf cwe=CWE-918 framework=express pair=express-api-path title="gateway appends the path query to the API origin without a slash"
const express = require('express');

const app = express();

app.get('/proxy/api', async (req, res) => {
  const response = await fetch(`https://api.example.com${req.query.path}`); // expect: security/no-user-controlled-fetch-url
  const data = await response.json();
  res.status(response.status).json(data);
});

app.listen(3000);
