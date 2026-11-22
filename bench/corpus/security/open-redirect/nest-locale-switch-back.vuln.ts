// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-locale-switch-back title="locale switch redirects with a status to the back query value"
import { Controller, Get, Query, Res } from '@nestjs/common';
import { IsIn } from 'class-validator';
import type { Response } from 'express';

const DESTINATIONS: Record<string, string> = { billing: '/billing', profile: '/profile' };

export class SwitchDto {
  @IsIn(['billing', 'profile'])
  back: string = 'profile';
}

@Controller('locale')
export class LocaleController {
  @Get('switch')
  switch(@Query() dto: SwitchDto, @Res() res: Response) {
    res.cookie('locale', 'pl');
    res.redirect(302, dto.back); // expect: security/no-user-controlled-redirect
  }
}
