// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-ping-controller title="host passed as an argument array to execFile, no shell"
// ok
import { Controller, Get, Query } from '@nestjs/common';
import { execFile } from 'node:child_process';

@Controller('network')
export class NetworkController {
  @Get('ping')
  ping(@Query('host') host: string): Promise<{ output: string }> {
    return new Promise((resolve, reject) => {
      execFile('ping', ['-c', '1', host], (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ output: stdout });
      });
    });
  }
}
