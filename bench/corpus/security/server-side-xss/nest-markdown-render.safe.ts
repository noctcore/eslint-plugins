// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-markdown-render title="marked output piped through DOMPurify.sanitize"
// ok
import { Body, Controller, Header, Post } from '@nestjs/common';
import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

@Controller('docs')
export class DocsController {
  @Post('render')
  @Header('Content-Type', 'text/html')
  render(@Body('markdown') markdown: string): string {
    const text = markdown ?? '';
    if (text.length > 20000) {
      return '<p>too long</p>';
    }
    return `<main>${DOMPurify.sanitize(marked(text) as string)}</main>`;
  }
}
