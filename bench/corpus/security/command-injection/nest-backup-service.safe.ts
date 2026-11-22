// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-backup-service title="database name checked against an allowlist in the service before exec"
// ok
import { BadRequestException, Controller, Injectable, Param, Post } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);
const DATABASES = ['orders', 'customers', 'inventory'];

@Injectable()
export class BackupService {
  async dump(database: string): Promise<string> {
    if (!DATABASES.includes(database)) {
      throw new BadRequestException('unknown database');
    }
    const target = `/var/backups/${database}.sql`;
    await run(`pg_dump -h db.internal.example.com ${database} > ${target}`);
    return target;
  }
}

@Controller('backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Post(':database')
  create(@Param('database') database: string) {
    return this.backups.dump(database);
  }
}
