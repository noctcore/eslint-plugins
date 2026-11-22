// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-log-stream title="anchored regex limits the file to a flat log name"
// ok
import { Controller, Get, Query, BadRequestException, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';

const LOG_ROOT = '/var/log/service';

@Controller('logs')
export class LogsController {
  @Get()
  stream(@Query('file') file: string) {
    if (!/^[\w.-]+\.log$/.test(file)) {
      throw new BadRequestException('invalid log name');
    }
    const full = `${LOG_ROOT}/${file}`;
    return new StreamableFile(createReadStream(full));
  }
}
