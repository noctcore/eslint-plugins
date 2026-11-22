// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-delete-attachment title="id looked up in a map to a fixed stored file name before joining"
// ok
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ATTACH_DIR = path.resolve(__dirname, 'attachments');
const router = express.Router();
const attachments = new Map([
  ['a1', 'report.docx'],
  ['a2', 'photo.jpg'],
]);

router.delete('/attachments/:id', async (req, res) => {
  const stored = attachments.get(req.params.id);
  if (!stored) {
    return res.sendStatus(404);
  }
  const target = path.join(ATTACH_DIR, stored);
  await fs.promises.unlink(target);
  res.sendStatus(204);
});

module.exports = router;
