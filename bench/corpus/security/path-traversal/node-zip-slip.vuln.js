// @bench category=path-traversal cwe=CWE-22 framework=node pair=node-zip-slip title="archive entry path joined onto the extract root and written (zip slip)"
const fs = require('node:fs');
const path = require('node:path');

function extractAll(entries, destDir) {
  const root = path.resolve(destDir);
  for (const entry of entries) {
    const target = path.join(root, entry.path); // expect: security/require-path-containment
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
}

module.exports = { extractAll };
