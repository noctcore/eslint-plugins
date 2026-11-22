// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-zip-slip title="relative path from the root rejected when dotdot or absolute"
// ok
const fs = require('node:fs');
const path = require('node:path');

function extractAll(entries, destDir) {
  const root = path.resolve(destDir);
  for (const entry of entries) {
    const target = path.join(root, entry.path);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`blocked entry ${entry.path}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
}

module.exports = { extractAll };
