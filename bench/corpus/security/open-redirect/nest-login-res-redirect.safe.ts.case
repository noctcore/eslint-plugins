// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-login-res-redirect title="next accepted only as a same-site relative path"
// ok
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Get('callback')
  async callback(@Query('ticket') ticket: string, @Query('next') next: string, @Res() res: Response) {
    const session = await this.auth.redeem(ticket);
    res.cookie('sid', session.id, { httpOnly: true });
    const local = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\');
    res.redirect(local ? next : '/');
  }
}
