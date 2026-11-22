// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-report-dto title="DTO name field from @Body interpolated into an exec call"
import { Body, Controller, Post } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);

class GenerateReportDto {
  name!: string;
}

@Controller('reports')
export class ReportsController {
  @Post()
  async generate(@Body() dto: GenerateReportDto) {
    const { stdout } = await run(`node ./scripts/report.js --name ${dto.name}`); // expect: security/no-shell-interpolation
    return { log: stdout };
  }
}
