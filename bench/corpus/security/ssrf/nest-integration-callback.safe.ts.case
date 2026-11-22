// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-integration-callback title="callbackUrl rejected unless its hostname is on the partner allowlist"
// ok
import { ForbiddenException, Body, Controller, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

class FinishDto {
  jobId!: string;
  callbackUrl!: string;
}

const PARTNER_HOSTS = ['callbacks.example.com', 'partners.example.com'];

@Injectable()
export class CallbackService {
  constructor(private readonly http: HttpService) {}

  async notify(dto: FinishDto) {
    const target = new URL(dto.callbackUrl);
    if (target.protocol !== 'https:' || !PARTNER_HOSTS.includes(target.hostname)) {
      throw new ForbiddenException('callback host not allowed');
    }
    const payload = { jobId: dto.jobId, state: 'done' };
    await firstValueFrom(this.http.post(target.href, payload));
    return { notified: true };
  }
}

@Controller('jobs')
export class JobsController {
  constructor(private readonly callbacks: CallbackService) {}

  @Post('finish')
  finish(@Body() dto: FinishDto) {
    return this.callbacks.notify(dto);
  }
}
