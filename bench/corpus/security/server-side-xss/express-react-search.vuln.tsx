// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-react-search title="React search page marks up the raw query through __html"
import express from 'express';
import { renderToString } from 'react-dom/server';

type Props = { query: string; count: number };

function SearchPage({ query, count }: Props) {
  const heading = { __html: `Results for <em>${query}</em>` }; // expect: security/require-sanitized-html
  return (
    <section>
      <h1 dangerouslySetInnerHTML={heading} />
      <p>{count} hits</p>
    </section>
  );
}

const app = express();

app.get('/find', (req, res) => {
  const query = String(req.query.q ?? '');
  res.send(renderToString(<SearchPage query={query} count={0} />));
});

app.listen(3007);
