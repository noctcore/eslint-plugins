// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-host-concat-path title="path query value appended directly after the app host"
import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('invite')
export class InviteController {
  @Get('done')
  done(@Query('path') path: string, @Res() res: Response) {
    res.cookie('invite', '', { maxAge: 0 });
    res.redirect(`https://app.example.com${path}`); // expect: security/no-user-controlled-redirect
  }
}
