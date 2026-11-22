// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-log-stream title="Query file interpolated into the log root path and streamed"
import { Controller, Get, Query, BadRequestException, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';

const LOG_ROOT = '/var/log/service';

@Controller('logs')
export class LogsController {
  @Get()
  stream(@Query('file') file: string) {
    const full = `${LOG_ROOT}/${file}`; // expect: security/require-path-containment
    return new StreamableFile(createReadStream(full));
  }
}
