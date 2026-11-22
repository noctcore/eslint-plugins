// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-login-res-redirect title="login callback redirects to the next query value through res"
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
    res.redirect(next || '/'); // expect: security/no-user-controlled-redirect
  }
}
