// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-oauth-callback-redirect-uri title="redirect_uri must be in the registered client URI set"
// ok
import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { OauthService } from './oauth.service';

const REGISTERED = new Set(['https://app.example.com/cb', 'https://admin.example.com/cb']);

@Controller('oauth')
export class OauthController {
  constructor(private readonly oauth: OauthService) {}

  @Get('authorize')
  async authorize(@Query('redirect_uri') redirectUri: string, @Query('state') state: string, @Res() res: Response) {
    const code = await this.oauth.issueCode(state);
    if (!REGISTERED.has(redirectUri)) throw new BadRequestException('unknown redirect_uri');
    res.redirect(`${redirectUri}?code=${code}&state=${state}`);
  }
}
