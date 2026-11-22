// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-ping-controller title="host from @Query concatenated into an exec ping"
import { Controller, Get, Query } from '@nestjs/common';
import { exec } from 'node:child_process';

@Controller('network')
export class NetworkController {
  @Get('ping')
  ping(@Query('host') host: string): Promise<{ output: string }> {
    return new Promise((resolve, reject) => {
      exec('ping -c 1 ' + host, (error, stdout) => { // expect: security/no-shell-interpolation
        if (error) {
          reject(error);
          return;
        }
        resolve({ output: stdout });
      });
    });
  }
}
