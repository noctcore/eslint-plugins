// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-location-header-cookie title="Location header set from a client cookie value through res.location"
import { Controller, Get, HttpStatus, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

const APP_ORIGIN = 'https://app.example.com';

@Controller('auth')
export class FinishController {
  @Get('finish')
  finish(@Req() req: Request, @Res() res: Response) {
    const saved = String(req.cookies['return_to'] ?? '/');
    res.clearCookie('return_to');
    res.status(HttpStatus.FOUND).location(saved).send(); // expect: security/no-user-controlled-redirect
  }
}
