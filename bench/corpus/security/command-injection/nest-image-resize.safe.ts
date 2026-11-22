// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-image-resize title="width parsed with parseInt and range checked before the exec call"
// ok
import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { exec } from 'node:child_process';

@Controller('images')
export class ImagesController {
  @Get('resize')
  resize(@Query('width') width: string, @Query('name') name = 'hero'): Promise<string> {
    const px = parseInt(width, 10);
    if (!Number.isInteger(px) || px < 16 || px > 4096) {
      throw new BadRequestException('width out of range');
    }
    const output = `/tmp/${name.length}-resized.png`;
    return new Promise((resolve, reject) => {
      exec(`convert /assets/hero.png -resize ${px} ${output}`, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }
}
