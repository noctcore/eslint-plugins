// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-logout-redirect-url title="returnTo allowed only for listed https hosts"
// ok
import { Controller, Post, Query, Redirect } from '@nestjs/common';
import { SessionService } from './session.service';

const ALLOWED_HOSTS = ['app.example.com', 'www.example.com'];

@Controller('session')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post('logout')
  @Redirect('/', 302)
  async logout(@Query('returnTo') returnTo?: string) {
    await this.sessions.endCurrent();
    if (!returnTo) return undefined;
    const url = new URL(returnTo, 'https://app.example.com');
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) return undefined;
    return { url: url.href };
  }
}
