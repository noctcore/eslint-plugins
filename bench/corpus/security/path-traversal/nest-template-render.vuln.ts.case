// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-template-render title="Param name joined into a template path under the templates dir"
import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const TEMPLATE_DIR = path.resolve(__dirname, 'templates');
const KNOWN = ['welcome', 'reset', 'digest'] as const;

@Controller('templates')
export class TemplatesController {
  @Get(':name')
  async render(@Param('name') name: string) {
    const file = path.join(TEMPLATE_DIR, `${name}.hbs`); // expect: security/require-path-containment
    return { source: await readFile(file, 'utf8') };
  }
}
