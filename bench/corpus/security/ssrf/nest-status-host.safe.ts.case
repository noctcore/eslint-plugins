// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-status-host title="host query validated against a Set of service hosts before interpolation"
// ok
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';

const SERVICE_HOSTS = new Set(['billing.svc.example.com', 'search.svc.example.com']);

@Controller('probe')
export class ProbeController {
  @Get('health')
  async health(@Query('host') host: string) {
    if (!SERVICE_HOSTS.has(host)) {
      throw new BadRequestException('unknown service');
    }
    try {
      const res = await fetch(`https://${host}/health`);
      return { up: res.ok };
    } catch {
      return { up: false };
    }
  }
}
