// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-json-search title="search endpoint returns an HTML string built from the query"
import { Controller, Get, Query } from '@nestjs/common';
import { Header } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('lookup')
export class LookupController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Header('Content-Type', 'text/html')
  async find(@Query('q') q = ''): Promise<string> {
    const hits = await this.search.find(q);
    return `<h2>${q}</h2><p>${hits.length} matches</p>`; // expect: security/require-sanitized-html
  }
}
