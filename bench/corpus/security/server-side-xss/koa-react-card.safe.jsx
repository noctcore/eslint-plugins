// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-react-card title="headline escaped by React as a text child"
// ok
const Koa = require('koa');
const React = require('react');
const { renderToString } = require('react-dom/server');

function Card({ headline }) {
  return (
    <div className="card">
      <h2>{headline}</h2>
    </div>
  );
}

const app = new Koa();

app.use(async (ctx) => {
  const headline = String(ctx.query.headline || 'Untitled');
  ctx.type = 'html';
  ctx.body = renderToString(<Card headline={headline} />);
});

app.listen(4006);
