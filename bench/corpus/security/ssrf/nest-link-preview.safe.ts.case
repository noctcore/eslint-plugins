// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-link-preview title="DTO url parsed and its hostname checked against an allowlist"
// ok
import { BadRequestException, Body, Controller, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

class PreviewDto {
  url!: string;
}

const ALLOWED_HOSTS = ['news.example.com', 'blog.example.com'];

@Injectable()
export class PreviewService {
  constructor(private readonly http: HttpService) {}

  async load(dto: PreviewDto) {
    const url = new URL(dto.url);
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      throw new BadRequestException('host not allowed');
    }
    const res = await firstValueFrom(this.http.get(url.href));
    return { length: String(res.data).length };
  }
}

@Controller('preview')
export class PreviewController {
  constructor(private readonly service: PreviewService) {}

  @Post()
  create(@Body() dto: PreviewDto) {
    return this.service.load(dto);
  }
}
