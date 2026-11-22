// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-logout-redirect-url title="logout Redirect returns the returnTo query value as url"
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
    return returnTo ? { url: returnTo } : undefined; // expect: security/no-user-controlled-redirect
  }
}
