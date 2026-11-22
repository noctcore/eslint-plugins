// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-image-import title="image import downloads the DTO imageUrl through HttpService"
import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

class ImportImageDto {
  imageUrl!: string;
}

@Injectable()
export class ImageService {
  constructor(private readonly http: HttpService) {}

  async importImage(dto: ImportImageDto) {
    const res = await firstValueFrom(this.http.get(dto.imageUrl, { responseType: 'arraybuffer' })); // expect: security/no-user-controlled-fetch-url
    return { bytes: res.data.byteLength };
  }
}

@Controller('images')
export class ImageController {
  constructor(private readonly images: ImageService) {}

  @Post('import')
  run(@Body() dto: ImportImageDto) {
    return this.images.importImage(dto);
  }
}
