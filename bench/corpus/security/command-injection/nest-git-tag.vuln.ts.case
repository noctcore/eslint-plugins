// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-git-tag title="tag from @Param interpolated into execSync git show"
import { Controller, Get, Param } from '@nestjs/common';
import { execSync } from 'node:child_process';

@Controller('releases')
export class ReleasesController {
  private readonly repo = '/srv/acme/monorepo';

  @Get(':tag')
  describe(@Param('tag') tag: string) {
    const message = execSync(`git -C ${this.repo} tag -n1 ${tag}`, { encoding: 'utf8' }); // expect: security/no-shell-interpolation
    return { tag, message: message.trim() };
  }

  @Get()
  list() {
    return execSync(`git -C ${this.repo} tag --list`, { encoding: 'utf8' }).split('\n');
  }
}
