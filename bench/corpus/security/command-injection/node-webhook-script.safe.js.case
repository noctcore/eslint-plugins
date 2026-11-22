// @bench category=command-injection cwe=CWE-78 framework=node pair=node-webhook-script title="JSON body field switched onto fixed scripts before spawn bash -c"
// ok
const http = require('node:http');
const { spawn } = require('node:child_process');

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const { project } = JSON.parse(raw);
    let script;
    switch (project) {
      case 'web':
        script = 'cd /srv/acme/web && ./build.sh';
        break;
      case 'api':
        script = 'cd /srv/acme/api && ./build.sh';
        break;
      default:
        res.writeHead(400);
        res.end('unknown project');
        return;
    }
    const child = spawn('bash', ['-c', script]);
    child.on('close', (code) => {
      res.writeHead(code === 0 ? 200 : 500);
      res.end(JSON.stringify({ code }));
    });
  });
});

server.listen(7000);
