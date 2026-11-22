// @bench category=cookie-flags cwe=CWE-1004 framework=nest pair=nest-oauth-shared-const title="oauth callback cookie spreads shared options and adds httpOnly"
// ok
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { OAuthService } from './oauth.service';

const SESSION_COOKIE: CookieOptions = {
  path: '/',
  secure: true,
  sameSite: 'lax',
  maxAge: 3_600_000,
};

@Controller('oauth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  @Get('callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    const sid = await this.oauth.createSessionFromCode(code);
    res.cookie('sid', sid, { ...SESSION_COOKIE, httpOnly: true });
    res.redirect('/');
  }
}
