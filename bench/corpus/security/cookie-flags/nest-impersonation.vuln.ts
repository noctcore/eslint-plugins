// @bench category=cookie-flags cwe=CWE-614 framework=nest pair=nest-impersonation title="impersonation access token cookie with secure false"
import { Controller, Post, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ImpersonationService } from './impersonation.service';

@Controller('admin')
export class ImpersonationController {
  constructor(private readonly svc: ImpersonationService) {}

  @Post('impersonate/:id')
  async start(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const token = await this.svc.issueFor(id);
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: false, // expect: security/auth-cookie-flags
      sameSite: 'strict',
      maxAge: 900_000,
    });
    return { impersonating: id };
  }
}
