// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-service-restart title="service name mapped to constant commands, unknown names rejected"
// ok
import { Controller, NotFoundException, Post, Query } from '@nestjs/common';
import * as cp from 'node:child_process';

const RESTART_COMMANDS: Record<string, string> = {
  api: 'systemctl restart acme-api',
  worker: 'systemctl restart acme-worker',
  scheduler: 'systemctl restart acme-scheduler',
};

@Controller('ops')
export class OpsController {
  @Post('restart')
  restart(@Query('service') service: string): Promise<{ restarted: string }> {
    const command = Object.hasOwn(RESTART_COMMANDS, service) ? RESTART_COMMANDS[service] : undefined;
    if (!command) {
      throw new NotFoundException('unknown service');
    }
    return new Promise((resolve, reject) => {
      cp.exec(command, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ restarted: service });
      });
    });
  }
}
