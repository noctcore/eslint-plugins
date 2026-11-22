// @bench category=path-traversal cwe=CWE-22 framework=koa pair=koa-image-by-id title="image id from the route joined onto the images dir and streamed"
const fs = require('node:fs');
const path = require('node:path');
const Koa = require('koa');
const Router = require('@koa/router');

const IMAGES = path.resolve(__dirname, 'images');
const IMAGE_FILES = { logo: 'logo.png', banner: 'banner.jpg', icon: 'icon.svg' };
const router = new Router();

router.get('/img/:id', async (ctx) => {
  const file = path.join(IMAGES, ctx.params.id); // expect: security/require-path-containment
  ctx.body = fs.createReadStream(file);
});

new Koa().use(router.routes()).listen(3003);
