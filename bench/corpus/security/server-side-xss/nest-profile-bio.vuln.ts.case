// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-profile-bio title="profile endpoint renders the stored bio into HTML"
import { Controller, Get, Header, Param } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly users: UsersService) {}

  @Get(':slug')
  @Header('Content-Type', 'text/html')
  async profile(@Param('slug') slug: string): Promise<string> {
    const person = await this.users.bySlug(slug);
    return `<section class="bio"><h1>Profile</h1>${person.bio}</section>`; // expect: security/require-sanitized-html
  }
}
