// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-feed-reader title="stored subscription URL checked against the feed host allowlist at read time"
// ok
import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { SubscriptionRepository } from './subscription.repository';

const FEED_HOSTS = ['feeds.example.com', 'rss.example.com'];

@Injectable()
export class FeedReaderService {
  constructor(
    private readonly http: HttpService,
    private readonly subs: SubscriptionRepository,
  ) {}

  async refresh(userId: string) {
    const sub = await this.subs.findByUser(userId);
    const feed = new URL(sub.feedUrl);
    if (feed.protocol !== 'https:' || !FEED_HOSTS.includes(feed.hostname)) {
      throw new UnprocessableEntityException('feed host not allowed');
    }
    const res = await firstValueFrom(this.http.get(feed.href, { timeout: 4000 }));
    return { bytes: String(res.data).length };
  }
}
