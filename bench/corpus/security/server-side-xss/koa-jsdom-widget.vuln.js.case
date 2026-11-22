// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-jsdom-widget title="jsdom node innerHTML set from the query string"
const Koa = require('koa');
const { JSDOM } = require('jsdom');

const shell = '<!doctype html><body><div id="greeting"></div><footer>site</footer></body>';
const app = new Koa();

app.use(async (ctx) => {
  const name = String(ctx.query.name || 'friend');
  const dom = new JSDOM(shell);
  const node = dom.window.document.querySelector('#greeting');
  node.innerHTML = '<b>Hello ' + name + '</b>'; // expect: security/require-sanitized-html
  ctx.type = 'html';
  ctx.body = dom.serialize();
});

app.listen(4004);
