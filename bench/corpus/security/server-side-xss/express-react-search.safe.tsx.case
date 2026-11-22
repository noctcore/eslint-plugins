// @bench category=server-side-xss cwe=CWE-79 framework=express pair=express-react-search title="query shown as a text child inside the heading"
// ok
import express from 'express';
import { renderToString } from 'react-dom/server';

type Props = { query: string; count: number };

function SearchPage({ query, count }: Props) {
  return (
    <section>
      <h1>Results for <em>{query}</em></h1>
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
