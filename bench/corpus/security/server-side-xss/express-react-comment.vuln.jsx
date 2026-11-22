// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-react-comment title="React comment list sets __html from the request body"
import express from 'express';
import { renderToString } from 'react-dom/server';

function Comment({ text }) {
  return (
    <li>
      <span className="label">Comment</span>
      <div
        dangerouslySetInnerHTML={{ __html: text }} // expect: security/require-sanitized-html
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
