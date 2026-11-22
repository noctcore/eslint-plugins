// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-json-search title="search endpoint returns JSON instead of HTML"
// ok
import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

@Controller('lookup')
export class LookupController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async find(@Query('q') q = ''): Promise<{ q: string; count: number }> {
    const hits = await this.search.find(q);
    return { q, count: hits.length };
  }
}
