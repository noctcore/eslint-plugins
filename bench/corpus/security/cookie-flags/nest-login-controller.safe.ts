// @bench category=cookie-flags cwe=CWE-1004 framework=nest pair=nest-login-controller title="login controller sets session cookie with all flags"
// ok
import { Body, Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(
    @Body() dto: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const sessionId = await this.auth.login(dto.email, dto.password);
    res.cookie('session', sessionId, { maxAge: 86_400_000, httpOnly: true, secure: true, sameSite: 'lax' });
    return { ok: true };
  }
}
