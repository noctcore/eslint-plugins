// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-report-dto title="DTO name field restricted by @Matches under ValidationPipe, then interpolated"
// ok
import { Body, Controller, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Matches } from 'class-validator';

const run = promisify(exec);

class GenerateReportDto {
  @Matches(/^[a-z0-9-]{1,32}$/)
  name!: string;
}

@Controller('reports')
@UsePipes(new ValidationPipe({ whitelist: true }))
export class ReportsController {
  @Post()
  async generate(@Body() dto: GenerateReportDto) {
    const { stdout } = await run(`node ./scripts/report.js --name ${dto.name}`);
    return { log: stdout };
  }
}
