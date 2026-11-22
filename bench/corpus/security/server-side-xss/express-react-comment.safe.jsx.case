// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-react-comment title="comment sanitized with DOMPurify before __html"
// ok
import express from 'express';
import { renderToString } from 'react-dom/server';
import DOMPurify from 'isomorphic-dompurify';

function Comment({ text }) {
  return (
    <li>
      <span className="label">Comment</span>
      <div
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(text) }}
      />
    </li>
  );
}

const app = express();
app.use(express.json());

app.post('/comments/render', (req, res) => {
  const items = (req.body.comments || []).map((c, i) => <Comment key={i} text={c} />);
  res.send(renderToString(<ul>{items}</ul>));
});

app.listen(3006);
