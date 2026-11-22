// @bench category=path-traversal cwe=CWE-22 framework=express pair=express-export-download title="export name from the route joined onto the exports dir and downloaded"
import path from 'node:path';
import express, { Router } from 'express';

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
const router = Router();

router.get('/exports/:name', (req, res) => {
  res.download(path.join(EXPORTS_DIR, req.params.name)); // expect: security/require-path-containment
});

router.get('/exports', (_req, res) => {
  res.json(['users.csv', 'orders.csv', 'products.csv']);
});

export default router;
