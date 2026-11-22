// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-host-concat-path title="path guard throws unless it starts with a single slash"
// ok
import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('invite')
export class InviteController {
  @Get('done')
  done(@Query('path') path: string, @Res() res: Response) {
    res.cookie('invite', '', { maxAge: 0 });
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
      throw new BadRequestException('path must be local');
    }
    res.redirect(`https://app.example.com${path}`);
  }
}
