// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-pdf-render title="page URL allowlisted, resolved address checked for private ranges"
// ok
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { lookup } from 'node:dns/promises';

class RenderDto {
  page!: string;
}

const PAGE_HOSTS = ['reports.example.com', 'docs.example.com'];
const PRIVATE = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

@Controller('pdf')
export class PdfController {
  @Post()
  async render(@Body() dto: RenderDto) {
    const url = new URL(dto.page);
    if (url.protocol !== 'https:' || !PAGE_HOSTS.includes(url.hostname)) {
      throw new BadRequestException('page host not allowed');
    }
    const { address } = await lookup(url.hostname);
    if (PRIVATE.test(address)) throw new BadRequestException('private address');
    const res = await fetch(url, { redirect: 'error' });
    const html = await res.text();
    return { pages: Math.ceil(html.length / 3000) };
  }
}
