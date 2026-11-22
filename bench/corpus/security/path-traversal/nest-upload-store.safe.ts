// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-upload-store title="basename of the body filename used when joining"
// ok
import { Body, Controller, Post } from '@nestjs/common';
import { writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const STORE = '/var/lib/app/uploads';

@Controller('uploads')
export class UploadsController {
  @Post()
  async save(@Body('filename') filename: string, @Body('content') content: string) {
    const dest = join(STORE, basename(filename));
    await writeFile(dest, Buffer.from(content, 'base64'));
    return { ok: true };
  }
}
