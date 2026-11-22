// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-webhook-tester title="webhook tester calls fetch with the DTO callbackUrl"
import { Body, Controller, Post } from '@nestjs/common';

class TestHookDto {
  callbackUrl!: string;
  event!: string;
}

@Controller('webhooks')
export class WebhookController {
  @Post('test')
  async test(@Body() dto: TestHookDto) {
    const body = JSON.stringify({ event: dto.event, test: true });
    const res = await fetch(dto.callbackUrl, { method: 'POST', body }); // expect: security/no-user-controlled-fetch-url
    return { status: res.status };
  }
}
