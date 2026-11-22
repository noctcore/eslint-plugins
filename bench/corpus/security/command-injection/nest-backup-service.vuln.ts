// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-backup-service title="route param reaches an injectable service that execs a pg_dump string"
import { Controller, Injectable, Param, Post } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(exec);

@Injectable()
export class BackupService {
  async dump(database: string): Promise<string> {
    const target = `/var/backups/${database}.sql`;
    await run(`pg_dump -h db.internal.example.com ${database} > ${target}`); // expect: security/no-shell-interpolation
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
