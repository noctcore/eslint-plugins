// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-dig-records title="DTO domain restricted by @IsIn under ValidationPipe before spawn sh -c"
// ok
import { Body, Controller, Post, ValidationPipe } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { IsIn } from 'class-validator';

class DigDto {
  @IsIn(['acme.example.com', 'api.example.com', 'mail.example.com'])
  domain!: string;
}

@Controller('dns')
export class DnsController {
  @Post('dig')
  dig(@Body(new ValidationPipe()) dto: DigDto): Promise<string> {
    const cmd = `dig +short ${dto.domain} A`;
    return new Promise((resolve) => {
      const child = spawn('sh', ['-c', cmd]);
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', () => resolve(out));
    });
  }
}
