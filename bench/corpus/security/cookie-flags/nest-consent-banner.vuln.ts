// @bench category=cookie-flags cwe=CWE-1004 framework=nest pair=nest-consent-banner title="auth token cookie set with no flags after login"
import { Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SessionService } from './session.service';

@Controller('session')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post()
  async start(@Res({ passthrough: true }) res: Response) {
    const token = await this.sessions.start();
    res.cookie('auth_token', token); // expect: security/auth-cookie-flags
    return { ok: true };
  }
}
