// @bench category=command-injection cwe=CWE-78 framework=node pair=node-cli-archive-handler title="exported handler passes the directory to execFileSync as an argument"
// ok
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const ARCHIVE_ROOT = '/srv/acme/archives';

/**
 * Called by the job runner with the parsed request payload.
 */
function archiveHandler(payload) {
  const dir = payload.dir;
  const outFile = path.join(ARCHIVE_ROOT, 'latest.tgz');
  execFileSync('tar', ['-czf', outFile, '--', dir], { stdio: 'inherit' });
  return { archive: outFile };
}

module.exports = { archiveHandler };
