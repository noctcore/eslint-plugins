// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-markdown-render title="markdown body converted by marked and returned as HTML"
import { Body, Controller, Header, Post } from '@nestjs/common';
import { marked } from 'marked';

@Controller('docs')
export class DocsController {
  @Post('render')
  @Header('Content-Type', 'text/html')
  render(@Body('markdown') markdown: string): string {
    const text = markdown ?? '';
    if (text.length > 20000) {
      return '<p>too long</p>';
    }
    return `<main>${marked(text)}</main>`; // expect: security/require-sanitized-html
  }
}
