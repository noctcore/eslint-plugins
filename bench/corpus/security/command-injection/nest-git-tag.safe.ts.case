// @bench category=command-injection cwe=CWE-78 framework=nest pair=nest-git-tag title="tag validated by regex with BadRequestException before execSync"
// ok
import { BadRequestException, Controller, Get, Param } from '@nestjs/common';
import { execSync } from 'node:child_process';

@Controller('releases')
export class ReleasesController {
  private readonly repo = '/srv/acme/monorepo';

  @Get(':tag')
  describe(@Param('tag') tag: string) {
    if (!/^v\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(tag)) {
      throw new BadRequestException('invalid tag');
    }
    const message = execSync(`git -C ${this.repo} tag -n1 ${tag}`, { encoding: 'utf8' });
    return { tag, message: message.trim() };
  }

  @Get()
  list() {
    return execSync(`git -C ${this.repo} tag --list`, { encoding: 'utf8' }).split('\n');
  }
}
