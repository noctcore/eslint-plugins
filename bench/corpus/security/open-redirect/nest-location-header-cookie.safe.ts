// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-location-header-cookie title="cookie parsed and origin compared before using path and search"
// ok
import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

const APP_ORIGIN = 'https://app.example.com';

@Controller('auth')
export class FinishController {
  @Get('finish')
  finish(@Req() req: Request, @Res() res: Response) {
    const saved = String(req.cookies['return_to'] ?? '/');
    res.clearCookie('return_to');
    const url = new URL(saved, APP_ORIGIN);
    const target = url.origin === APP_ORIGIN ? url.pathname + url.search : '/';
    res.status(HttpStatus.FOUND).location(target).send();
  }
}
