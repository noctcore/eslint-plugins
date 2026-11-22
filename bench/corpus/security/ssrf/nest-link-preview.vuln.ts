// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-link-preview title="DTO url goes straight into HttpService get"
import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

class PreviewDto {
  url!: string;
}

@Injectable()
export class PreviewService {
  constructor(private readonly http: HttpService) {}

  async load(dto: PreviewDto) {
    const res = await firstValueFrom(this.http.get(dto.url)); // expect: security/no-user-controlled-fetch-url
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
