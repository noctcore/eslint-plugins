// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-integration-callback title="integration callback posts a result to the DTO callbackUrl"
import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

class FinishDto {
  jobId!: string;
  callbackUrl!: string;
}

@Injectable()
export class CallbackService {
  constructor(private readonly http: HttpService) {}

  async notify(dto: FinishDto) {
    const payload = { jobId: dto.jobId, state: 'done' };
    await firstValueFrom(this.http.post(dto.callbackUrl, payload)); // expect: security/no-user-controlled-fetch-url
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
