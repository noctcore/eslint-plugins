// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-webhook-tester title="callbackUrl hostname must match an anchored regex before fetch"
// ok
import { BadRequestException, Body, Controller, Post } from '@nestjs/common';

class TestHookDto {
  callbackUrl!: string;
  event!: string;
}

const HOOK_HOST = /^([a-z0-9-]+\.)*hooks\.example\.com$/;

@Controller('webhooks')
export class WebhookController {
  @Post('test')
  async test(@Body() dto: TestHookDto) {
    const target = new URL(dto.callbackUrl);
    if (target.protocol !== 'https:' || !HOOK_HOST.test(target.hostname)) {
      throw new BadRequestException('callback host not allowed');
    }
    const body = JSON.stringify({ event: dto.event, test: true });
    const res = await fetch(target, { method: 'POST', body });
    return { status: res.status };
  }
}
