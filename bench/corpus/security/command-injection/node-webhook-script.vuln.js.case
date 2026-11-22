// @bench category=command-injection cwe=CWE-78 framework=node pair=node-webhook-script title="JSON body field built into a script run with spawn bash -c"
const http = require('node:http');
const { spawn } = require('node:child_process');

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const { project } = JSON.parse(raw);
    const script = `cd /srv/acme/${project} && ./build.sh`;
    const child = spawn('bash', ['-c', script]); // expect: security/no-shell-interpolation
    child.on('close', (code) => {
      res.writeHead(code === 0 ? 200 : 500);
      res.end(JSON.stringify({ code }));
    });
  });
});

server.listen(7000);
