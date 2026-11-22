// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-zip-extract title="zip entry path joined onto the destination dir and written (zip slip)"
import { Injectable } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

interface ZipEntry {
  path: string;
  data: Buffer;
}

@Injectable()
export class ArchiveService {
  async extract(entries: ZipEntry[], destDir: string) {
    const root = path.resolve(destDir);
    for (const entry of entries) {
      const out = path.join(root, entry.path); // expect: security/require-path-containment
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, entry.data);
    }
  }
}
