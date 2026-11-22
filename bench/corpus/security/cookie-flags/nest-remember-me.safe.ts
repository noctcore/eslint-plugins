// @bench category=cookie-flags cwe=CWE-1004 framework=nest pair=nest-remember-me title="remember-me cookie with httpOnly and env based secure"
// ok
import { Controller, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RememberService } from './remember.service';

@Controller('auth')
export class RememberController {
  constructor(private readonly remember: RememberService) {}

  @Post('remember')
  async remember_(@Res({ passthrough: true }) res: Response) {
    const token = await this.remember.issue();
    res.cookie('remember_me', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 2_592_000_000 });
    return { remembered: true };
  }
}
