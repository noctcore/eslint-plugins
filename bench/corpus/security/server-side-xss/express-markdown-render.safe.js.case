// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-markdown-render title="marked output passed through DOMPurify.sanitize"
// ok
const express = require('express');
const { marked } = require('marked');
const DOMPurify = require('isomorphic-dompurify');

const app = express();
app.use(express.json());

app.post('/notes/render', (req, res) => {
  const source = req.body.markdown;
  if (typeof source !== 'string') {
    res.status(400).send('markdown required');
    return;
  }
  res.type('html');
  res.send('<div class="note">' + DOMPurify.sanitize(marked(source)) + '</div>');
});

app.listen(3002);
