// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-service-restart title="service name from @Query interpolated into cp.exec systemctl restart"
import { Controller, Post, Query } from '@nestjs/common';
import * as cp from 'node:child_process';

@Controller('ops')
export class OpsController {
  @Post('restart')
  restart(@Query('service') service: string): Promise<{ restarted: string }> {
    return new Promise((resolve, reject) => {
      cp.exec(`systemctl restart ${service}`, (error) => { // expect: security/no-shell-interpolation
        if (error) {
          reject(error);
          return;
        }
        resolve({ restarted: service });
      });
    });
  }
}
