// @bench category=ssrf cwe=CWE-918 framework=nest pair=nest-image-import title="imageUrl hostname checked against a Set of image hosts"
// ok
import { BadRequestException, Body, Controller, Injectable, Post } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

class ImportImageDto {
  imageUrl!: string;
}

const IMAGE_HOSTS = new Set(['img.example.com', 'cdn.example.com']);

@Injectable()
export class ImageService {
  constructor(private readonly http: HttpService) {}

  async importImage(dto: ImportImageDto) {
    const source = new URL(dto.imageUrl);
    if (source.protocol !== 'https:' || !IMAGE_HOSTS.has(source.hostname)) {
      throw new BadRequestException('image host not allowed');
    }
    const res = await firstValueFrom(this.http.get(source.href, { responseType: 'arraybuffer' }));
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
