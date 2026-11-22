// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-pdf-render title="PDF renderer fetches a URL object built from the DTO page"
import { Body, Controller, Post } from '@nestjs/common';

class RenderDto {
  page!: string;
}

@Controller('pdf')
export class PdfController {
  @Post()
  async render(@Body() dto: RenderDto) {
    const url = new URL(dto.page);
    const res = await fetch(url, { redirect: 'follow' }); // expect: security/no-user-controlled-fetch-url
    const html = await res.text();
    return { pages: Math.ceil(html.length / 3000) };
  }
}
