// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-export-download title="export name must be in a fixed Set of known files"
// ok
import path from 'node:path';
import express, { Router } from 'express';

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
const router = Router();

router.get('/exports/:name', (req, res) => {
  const known = new Set(['users.csv', 'orders.csv', 'products.csv']);
  if (!known.has(req.params.name)) {
    res.status(404).json({ error: 'unknown export' });
    return;
  }
  res.download(path.join(EXPORTS_DIR, req.params.name));
});

router.get('/exports', (_req, res) => {
  res.json(['users.csv', 'orders.csv', 'products.csv']);
});

export default router;
