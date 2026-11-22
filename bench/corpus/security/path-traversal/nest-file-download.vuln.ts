// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-file-download title="Param file joined onto the files root and sent with sendFile"
import { Controller, Get, Param, Res, ForbiddenException } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'node:path';

const FILES_ROOT = path.resolve(process.cwd(), 'storage', 'files');

@Controller('files')
export class FilesController {
  @Get(':file')
  download(@Param('file') file: string, @Res() res: Response) {
    const full = path.join(FILES_ROOT, file); // expect: security/require-path-containment
    return res.sendFile(full);
  }

  @Get()
  list() {
    return { root: 'files' };
  }
}
