// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-attachment-delete title="uuid id looked up in a map to the stored file name before joining"
// ok
import { Controller, Delete, Param, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

const ATTACH_ROOT = '/srv/attachments';
const stored = new Map<string, string>([
  ['3f2b8c1e-6a4d-4e0b-9a77-1c5d2e8f9a10', 'contract.pdf'],
  ['b81d0a52-2c3e-4f6a-8d19-7e4a5b6c7d80', 'scan.png'],
]);

@Controller('attachments')
export class AttachmentsController {
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const fileName = stored.get(id);
    if (!fileName) {
      throw new NotFoundException();
    }
    const target = join(ATTACH_ROOT, fileName);
    await unlink(target);
    return { deleted: id };
  }
}
