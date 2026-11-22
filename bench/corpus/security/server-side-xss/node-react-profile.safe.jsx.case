// @bench category=server-side-xss cwe=CWE-79 framework=node pair=node-react-profile title="bio escaped by React as a text child"
// ok
const http = require('node:http');
const React = require('react');
const { renderToString } = require('react-dom/server');

function Profile({ bio }) {
  const label = 'Biography';
  return (
    <section>
      <h2>{label}</h2>
      <p>{bio}</p>
    </section>
  );
}

http
  .createServer((req, res) => {
    const bio = new URL(req.url, 'http://x').searchParams.get('bio') || '';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(renderToString(<Profile bio={bio} />));
  })
  .listen(5005);
