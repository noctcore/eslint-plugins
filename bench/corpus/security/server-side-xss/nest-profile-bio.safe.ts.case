// @bench category=server-side-xss cwe=CWE-79 framework=nest pair=nest-profile-bio title="stored bio cleaned by sanitize-html before it is returned"
// ok
import { Controller, Get, Header, Param } from '@nestjs/common';
import sanitizeHtml from 'sanitize-html';
import { UsersService } from './users.service';

@Controller('people')
export class PeopleController {
  constructor(private readonly users: UsersService) {}

  @Get(':slug')
  @Header('Content-Type', 'text/html')
  async profile(@Param('slug') slug: string): Promise<string> {
    const person = await this.users.bySlug(slug);
    const bio = sanitizeHtml(person.bio);
    return `<section class="bio"><h1>Profile</h1>${bio}</section>`;
  }
}
