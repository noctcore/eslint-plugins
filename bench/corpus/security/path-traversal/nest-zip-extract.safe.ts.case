// @bench category=path-traversal cwe=CWE-22 framework=nest pair=nest-zip-extract title="resolved entry path skipped unless it stays under the destination dir"
// ok
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
      const out = path.resolve(root, entry.path);
      if (!out.startsWith(root + path.sep)) {
        continue;
      }
      await mkdir(path.dirname(out), { recursive: true });
      await writeFile(out, entry.data);
    }
  }
}
