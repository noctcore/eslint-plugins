// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-image-resize title="width from @Query interpolated into an exec ImageMagick call"
import { Controller, Get, Query } from '@nestjs/common';
import { exec } from 'node:child_process';

@Controller('images')
export class ImagesController {
  @Get('resize')
  resize(@Query('width') width: string, @Query('name') name = 'hero'): Promise<string> {
    const output = `/tmp/${name.length}-resized.png`;
    return new Promise((resolve, reject) => {
      exec(`convert /assets/hero.png -resize ${width} ${output}`, (err) => { // expect: security/no-shell-interpolation
        if (err) {
          reject(err);
        } else {
          resolve(output);
        }
      });
    });
  }
}
