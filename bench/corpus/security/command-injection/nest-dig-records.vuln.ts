// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-dig-records title="DTO domain from @Body built into a command run with spawn sh -c"
import { Body, Controller, Post } from '@nestjs/common';
import { spawn } from 'node:child_process';

class DigDto {
  domain!: string;
}

@Controller('dns')
export class DnsController {
  @Post('dig')
  dig(@Body() dto: DigDto): Promise<string> {
    const cmd = `dig +short ${dto.domain} A`;
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', cmd]); // expect: security/no-shell-interpolation
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => resolve(out));
    });
  }
}
