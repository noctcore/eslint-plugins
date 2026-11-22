// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-template-render title="name must be in a const allowlist array, else 404"
// ok
import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const TEMPLATE_DIR = path.resolve(__dirname, 'templates');
const KNOWN = ['welcome', 'reset', 'digest'] as const;

@Controller('templates')
export class TemplatesController {
  @Get(':name')
  async render(@Param('name') name: string) {
    if (!(KNOWN as readonly string[]).includes(name)) {
      throw new NotFoundException();
    }
    const file = path.join(TEMPLATE_DIR, `${name}.hbs`);
    return { source: await readFile(file, 'utf8') };
  }
}
