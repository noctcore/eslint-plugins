// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-status-host title="health probe interpolates the host query into the URL"
import { Controller, Get, Query } from '@nestjs/common';

@Controller('probe')
export class ProbeController {
  @Get('health')
  async health(@Query('host') host: string) {
    try {
      const res = await fetch(`https://${host}/health`); // expect: security/no-user-controlled-fetch-url
      return { up: res.ok };
    } catch {
      return { up: false };
    }
  }
}
