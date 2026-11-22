// @bench category=cookie-flags cwe=CWE-1004 framework=nest pair=nest-consent-banner title="cookie consent flag set client readable with no flags"
// ok
import { Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SessionService } from './session.service';

@Controller('session')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post()
  async start(@Res({ passthrough: true }) res: Response) {
    const token = await this.sessions.start();
    res.cookie('cookie_consent', 'accepted', { maxAge: 31_536_000_000 });
    return { ok: true };
  }
}
