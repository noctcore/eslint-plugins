// @bench category=cookie-flags cwe=CWE-1275 framework=nest pair=nest-magic-link-fastify title="fastify magic link session cookie missing sameSite"
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { MagicLinkService } from './magic-link.service';

@Controller('magic')
export class MagicLinkController {
  constructor(private readonly links: MagicLinkService) {}

  @Get('verify')
  async verify(@Query('token') token: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const sid = await this.links.consume(token);
    reply.setCookie('session', sid, { path: '/', httpOnly: true, secure: true }); // expect: security/auth-cookie-flags
    return { verified: true };
  }
}
