// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-insert-adjacent title="jsdom insertAdjacentHTML inserts the request tag into the page"
import { Controller, Get, Header, Query } from '@nestjs/common';
import { JSDOM } from 'jsdom';

const shell = '<!doctype html><body><ul id="tags"><li>base</li></ul></body>';

@Controller('tags')
export class TagsController {
  @Get()
  @Header('Content-Type', 'text/html')
  list(@Query('tag') tag = ''): string {
    const dom = new JSDOM(shell);
    const list = dom.window.document.querySelector('#tags')!;
    list.insertAdjacentHTML('beforeend', `<li>${tag}</li>`); // expect: security/require-sanitized-html
    return dom.serialize();
  }
}
