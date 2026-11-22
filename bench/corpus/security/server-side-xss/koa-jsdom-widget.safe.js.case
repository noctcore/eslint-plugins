// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-jsdom-widget title="jsdom textContent used for the query string"
// ok
const Koa = require('koa');
const { JSDOM } = require('jsdom');

const shell = '<!doctype html><body><div id="greeting"></div><footer>site</footer></body>';
const app = new Koa();

app.use(async (ctx) => {
  const name = String(ctx.query.name || 'friend');
  const dom = new JSDOM(shell);
  const node = dom.window.document.querySelector('#greeting');
  node.textContent = 'Hello ' + name;
  ctx.type = 'html';
  ctx.body = dom.serialize();
});

app.listen(4004);
