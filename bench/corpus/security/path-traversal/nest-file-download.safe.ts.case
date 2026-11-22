// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-file-download title="resolved path checked to stay under the files root, else 403"
// ok
import { Controller, Get, Param, Res, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'node:path';

const FILES_ROOT = path.resolve(process.cwd(), 'storage', 'files');

@Controller('files')
export class FilesController {
  @Get(':file')
  download(@Param('file') file: string, @Res() res: Response) {
    const full = path.resolve(FILES_ROOT, file);
    if (!full.startsWith(FILES_ROOT + path.sep)) {
      throw new ForbiddenException();
    }
    return res.sendFile(full);
  }

  @Get()
  list() {
    return { root: 'files' };
  }
}
