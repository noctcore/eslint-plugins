// @bench category=server-side-xss cwe=CWE-79 framework=koa pair=koa-markdown-preview title="marked output piped through DOMPurify.sanitize"
// ok
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

const app = new Koa();
app.use(bodyParser());

app.use(async (ctx) => {
  if (ctx.method !== 'POST' || ctx.path !== '/preview') {
    ctx.status = 404;
    return;
  }
  const md: string = String((ctx.request.body as { md?: string }).md ?? '');
  ctx.type = 'text/html';
  ctx.body = `<article>${DOMPurify.sanitize(marked(md) as string)}</article>`;
});

app.listen(4003);
