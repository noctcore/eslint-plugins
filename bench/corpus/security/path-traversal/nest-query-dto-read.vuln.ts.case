// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-query-dto-read title="Query dto name joined onto the notes dir and read, dto only checks string"
import { Controller, Get, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const NOTES_DIR = '/srv/notes';

export class NoteQueryDto {
  @IsString()
  name!: string;
}

@Controller('notes')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class NotesController {
  @Get()
  async read(@Query() dto: NoteQueryDto) {
    const file = join(NOTES_DIR, dto.name); // expect: security/require-path-containment
    return readFile(file, 'utf8');
  }
}
