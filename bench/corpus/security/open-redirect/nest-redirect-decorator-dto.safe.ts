// @bench category=open-redirect cwe=CWE-601 framework=nest pair=nest-redirect-decorator-dto title="dto validated with class-validator path regex"
// ok
import { Controller, Get, Query, Redirect } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';

export class GoDto {
  @IsString()
  @IsOptional()
  @Matches(/^\/(?!\/)[a-z0-9/_-]*$/i)
  next: string = '/';
}

@Controller()
export class GoController {
  @Get('go')
  @Redirect('/', 302)
  go(@Query() dto: GoDto) {
    return { url: dto.next };
  }
}
