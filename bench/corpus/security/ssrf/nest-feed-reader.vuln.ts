// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-feed-reader title="feed reader requests a subscription URL stored by the user"
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SubscriptionRepository } from './subscription.repository';

@Injectable()
export class FeedReaderService {
  constructor(
    private readonly http: HttpService,
    private readonly subs: SubscriptionRepository,
  ) {}

  async refresh(userId: string) {
    const sub = await this.subs.findByUser(userId);
    const res = await firstValueFrom(this.http.get(sub.feedUrl, { timeout: 4000 })); // expect: security/no-user-controlled-fetch-url
    return { bytes: String(res.data).length };
  }
}
