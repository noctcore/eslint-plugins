// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-search-header title="query escaped before it is returned in the page"
// ok
import { Controller, Get, Header, Query } from '@nestjs/common';
import { SearchService } from './search.service';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @Header('Content-Type', 'text/html')
  async page(@Query('q') q = ''): Promise<string> {
    const hits = await this.search.find(q);
    return `<h1>Results for ${escapeHtml(q)}</h1><p>${hits.length} items</p>`;
  }
}
