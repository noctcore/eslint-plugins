// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-image-by-id title="image id mapped through a fixed table of file names"
// ok
const fs = require('node:fs');
const path = require('node:path');
const Koa = require('koa');
const Router = require('@koa/router');

const IMAGES = path.resolve(__dirname, 'images');
const IMAGE_FILES = { logo: 'logo.png', banner: 'banner.jpg', icon: 'icon.svg' };
const router = new Router();

router.get('/img/:id', async (ctx) => {
  const name = Object.hasOwn(IMAGE_FILES, ctx.params.id) ? IMAGE_FILES[ctx.params.id] : null;
  if (!name) {
    ctx.status = 404;
    return;
  }
  const file = path.join(IMAGES, name);
  ctx.body = fs.createReadStream(file);
});

new Koa().use(router.routes()).listen(3003);
