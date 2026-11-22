// @bench category=cookie-flags cwe=CWE-1004 framework=nest pair=nest-refresh-fastify title="fastify refresh token cookie with httpOnly false"
import { Controller, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TokenService } from './token.service';

@Controller('auth')
export class RefreshController {
  constructor(private readonly tokens: TokenService) {}

  @Post('refresh')
  async refresh(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const next = await this.tokens.rotate(req.cookies['refresh_token'] ?? '');
    reply.setCookie('refresh_token', next, {
      path: '/auth',
      httpOnly: false, // expect: security/auth-cookie-flags
      secure: true,
      sameSite: 'strict',
    });
    return { rotated: true };
  }
}
