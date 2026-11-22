// @bench category=server-side-xss cwe=CWE-79 framework=node pair=node-report-concat title="title cleaned with sanitize-html before concatenation"
// ok
import http from 'node:http';
import sanitizeHtml from 'sanitize-html';

const rows: string[][] = [['north', '12'], ['south', '7']];

http
  .createServer((req, res) => {
    const params = new URL(req.url ?? '/', 'http://localhost').searchParams;
    const title = params.get('title') ?? 'Report';
    const cleanTitle = sanitizeHtml(title, { allowedTags: [], allowedAttributes: {} });
    let html = '<html><body>';
    html += '<h1>' + cleanTitle + '</h1><table>';
    for (const [region, total] of rows) {
      html += '<tr><td>' + region + '</td><td>' + total + '</td></tr>';
    }
    html += '</table></body></html>';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  })
  .listen(5003);
