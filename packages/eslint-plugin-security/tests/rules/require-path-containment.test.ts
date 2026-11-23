import { ruleTester } from '@noctcore/eslint-test-utils';

import { requirePathContainmentRule } from '../../src/rules/require-path-containment';

const TS = 'handler.ts';
const ERR = [{ messageId: 'unguardedPathJoin' as const }];
const FS = [{ messageId: 'unguardedFsPath' as const }];

ruleTester.run('require-path-containment', requirePathContainmentRule, {
  valid: [
    // No request-shaped input.
    { code: `path.join(baseDir, 'static.txt');`, filename: TS },
    // A sanitized local (not a direct `req.*` argument) is not flagged.
    {
      code: `function h(req) { const safe = clean(req.params.file); return path.join(base, safe); }`,
      filename: TS,
    },
    // A `.startsWith` test of the joined value against the base and a separator suppresses.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); if (!p.startsWith(base + path.sep)) throw new Error('bad'); return p; }`,
      filename: TS,
    },
    // A test of a variable derived from the joined value through a path call.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); const n = path.normalize(p); if (!n.startsWith(base + path.sep)) throw new Error('bad'); return n; }`,
      filename: TS,
    },
    // Stored through a wrapping path call.
    {
      code: "import { join, normalize, sep } from 'node:path'; function h(req) { const p = normalize(join(base, req.params.file)); if (!p.startsWith(`${base}${sep}`)) throw new Error('bad'); return p; }",
      filename: TS,
    },
    // `path.relative(base, joined)` refused when it climbs and when it is absolute.
    {
      code: `function h(req) { const p = path.resolve(base, req.params.file); const rel = path.relative(base, p); if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('bad'); return p; }`,
      filename: TS,
    },
    // A configured guard helper that takes the joined value.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); assertInside(base, p); return p; }`,
      filename: TS,
      options: [{ containmentGuards: ['assertInside'] }],
    },
    // The escape-hatch comment convention suppresses.
    {
      code: `function h(req) {\n  // path-containment: base is a fixed constant, req.params.file is validated upstream\n  return path.join(base, req.params.file);\n}`,
      filename: TS,
    },
    // A bare `req` (not a member expression) is not the tracked sink.
    { code: `function h(req) { return path.resolve(base, req); }`, filename: TS },
    // An imported `join` from another module is not the path builder.
    {
      code: `import { join } from 'lodash'; function h(req) { return join(req.query.parts, '/'); }`,
      filename: TS,
    },
    // `resolve` from another module (a DI container) is not the path builder.
    {
      code: `import { resolve } from './container'; function h(req) { return resolve(req.params.token); }`,
      filename: TS,
    },
    // fs sinks: no request input, or a flow cut before the path.
    { code: "import fs from 'node:fs'; function h() { return fs.readFileSync('/srv/files/' + name); }", filename: TS },
    {
      code: "const fs = require('fs'); function h(req) { const id = Number(req.params.id); return fs.readFileSync(`/srv/files/${id}.json`); }",
      filename: TS,
    },
    {
      code: "const fs = require('fs'); const FILES = new Set(['a.json', 'b.json']); function h(req) { const name = String(req.query.file).trim(); if (!FILES.has(name)) { res.status(403).end(); return; } const target = '/srv/files/' + name; fs.unlinkSync(target); }",
      filename: TS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const name = decodeURIComponent(req.query.sort); if (!/^(asc|desc)$/.test(String(name))) return; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
    },
    {
      code: "const fs = require('fs'); const path = require('path'); function h(req) { const resolved = path.resolve('/srv/files', String(req.query.file)); if (!resolved.startsWith('/srv/files/')) return; const checked = resolved; fs.writeFileSync(checked, 'data'); }",
      filename: TS,
    },
    {
      code: "import { join, sep } from 'node:path'; import { readFile } from 'node:fs/promises'; async function h(req) { const name = req.body.name; const full = join(base, name); if (!full.startsWith(base + sep)) throw new Error('outside'); return readFile(full); }",
      filename: TS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const name = toSafeName(req.query.file); fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      options: [{ sanitizers: ['toSafeName'] }],
    },
    {
      code: "const fs = require('fs'); function h(req) { // path-containment: name is an id minted by the server\n const name = req.query.file; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
    },
    // A `readFile` that is not from fs is not a sink.
    { code: "function h(req) { return storage.readFile('/srv/' + req.query.file); }", filename: TS },
    { code: "function h(req) { return readFile('/srv/' + req.query.file); }", filename: TS },
    // A random name plus `extname`, a literal table, and a parsed object schema field.
    {
      code: "const fs = require('fs'); const path = require('path'); function h(req) { const name = crypto.randomUUID() + path.extname(req.file.originalname); fs.writeFileSync('/srv/uploads/' + name, req.file.buffer); }",
      filename: TS,
    },
    {
      code: "const fs = require('fs'); const FILES = { terms: 'terms.md', privacy: 'privacy.md' }; function h(req) { const name = FILES[req.params.id]; fs.unlinkSync('/srv/files/' + name); }",
      filename: TS,
    },
    {
      code: "import { z } from 'zod'; import fs from 'node:fs'; const Body = z.object({ theme: z.string().regex(/^[a-z0-9-]+$/) }); function h(req) { const { theme } = Body.parse(req.body); return fs.readFileSync(`/srv/themes/${theme}.css`); }",
      filename: TS,
    },
    // A request member checked against a handler-local literal list with an early return.
    {
      code: "import { join } from 'node:path'; const BASE = '/srv/templates'; function h(req, res) { const allowed = ['a.html', 'b.html']; if (!allowed.includes(req.params.name)) return res.status(404).end(); return res.sendFile(join(BASE, req.params.name)); }",
      filename: TS,
    },
    {
      code: "import fs from 'node:fs'; import { join } from 'node:path'; const NAMES = new Set(['a.css']); function h(req) { if (!NAMES.has(req.query.name)) { throw new Error('unknown'); } return fs.readFileSync(join('/srv/themes', req.query.name)); }",
      filename: TS,
    },
    // A basename refused as `.` and `..` (or anything starting with `.`) stays in its directory.
    {
      code: "const fs = require('fs'); const path = require('path'); function h(req) { const name = path.basename(String(req.query.file)); if (name === '.' || name === '..') return; return fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
    },
    {
      code: "import { basename, join } from 'node:path'; import { readFileSync } from 'node:fs'; function h(req) { const name = basename(req.query.u as string); if (name.startsWith('.')) throw new Error('hidden'); return readFileSync(join(BASE, name, 'profile.json')); }",
      filename: TS,
    },
    {
      code: "import { basename, join } from 'node:path'; import { rmSync } from 'node:fs'; function h(req) { const name = basename(req.query.u); if (['.', '..'].includes(name)) return; rmSync(join(BASE, name), { recursive: true }); }",
      filename: TS,
    },
    {
      code: "import { basename, join } from 'node:path'; import { rmSync } from 'node:fs'; function h(req) { const name = basename(req.query.u); if (name !== '..' && name !== '.') { rmSync(join(BASE, name), { recursive: true }); } }",
      filename: TS,
    },
    // A regex that cannot match `.` or `..`.
    {
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; if (!/^[a-z0-9_-][a-z0-9_.-]*$/i.test(name)) return; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
    },
    // A literal base that ends in a separator, a template with `${sep}`, a `const` base with a separator.
    {
      code: "import { resolve, sep } from 'node:path'; import fs from 'node:fs'; const ROOT = '/srv/app'; function h(req) { const full = resolve(ROOT, req.query.f); if (!full.startsWith(`${ROOT}${sep}`)) return; fs.readFileSync(full); }",
      filename: TS,
    },
    {
      code: "import { resolve } from 'node:path'; import fs from 'node:fs'; const ROOT = '/srv/app/'; function h(req) { const full = resolve(ROOT, req.query.f); if (full.startsWith(ROOT)) { fs.readFileSync(full); } }",
      filename: TS,
    },
    // The relative check inline, and through a `const` boolean.
    {
      code: "import { resolve, relative, isAbsolute } from 'node:path'; import fs from 'node:fs'; function h(req) { const full = resolve(BASE, req.query.f); const rel = relative(BASE, full); const ok = !rel.startsWith('..') && !isAbsolute(rel); if (!ok) return; fs.readFileSync(full); }",
      filename: TS,
    },
    // realpath of the joined path checked against the realpath of the base.
    {
      code: "import fs from 'node:fs'; import path from 'node:path'; async function h(req) { const real = await fs.promises.realpath(DOCS); const file = await fs.promises.realpath(path.join(DOCS, req.params.page)); if (!file.startsWith(real + path.sep)) return; return fs.promises.readFile(file, 'utf8'); }",
      filename: TS,
    },
    // Express's `root` option refuses `..` segments after decoding; a fixed root is safe.
    {
      code: "function h(req, res) { res.sendFile(req.params.file, { root: PUBLIC_DIR }); }",
      filename: TS,
    },
    {
      code: "function h(req, res) { res.download(req.params.file, 'report.pdf', { root: '/srv/reports' }); }",
      filename: TS,
    },
    // A TS wrapper on the path keeps the containment test.
    {
      code: "import { join, sep } from 'node:path'; import { readFileSync } from 'node:fs'; function h(req) { const full = join(BASE, req.query.f as string); if (!full.startsWith(BASE + sep)) return; return readFileSync(full!); }",
      filename: TS,
    },
    // A decoder before the basename and the dot check is fine: the check sees the decoded text.
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; function h(req) { const name = basename(decodeURIComponent(req.query.f)); if (name.startsWith('.')) return; fs.readFileSync(join(BASE, name)); }",
      filename: TS,
    },
    // A helper whose path is checked inside it, or called with a checked value.
    {
      code: "import fs from 'node:fs'; import { resolve, sep } from 'node:path'; function load(p) { const full = resolve(BASE, p); if (!full.startsWith(BASE + sep)) throw new Error('outside'); return fs.readFileSync(full); } function h(req) { return load(req.query.f); }",
      filename: TS,
    },
    {
      code: "import fs from 'node:fs'; function load(p) { return fs.readFileSync('/srv/files/' + p); } function h(req) { if (!['a.json', 'b.json'].includes(req.query.f)) return; return load(req.query.f); }",
      filename: TS,
    },
    // A helper called with server values only.
    {
      code: "import fs from 'node:fs'; function load(p) { return fs.readFileSync('/srv/files/' + p); } function h(req) { return load('fixed.json'); }",
      filename: TS,
    },
    // An object parameter whose fields are not request fields.
    {
      code: "import fs from 'node:fs'; function h({ name }) { return fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
    },
    // A member allowlisted and only inspected elsewhere stays allowlisted.
    {
      code: "import { join } from 'node:path'; import fs from 'node:fs'; function h(req, res) { if (!req.params || typeof req.params !== 'object') return; if (!['a.css'].includes(req.params.name)) return res.end(); return fs.readFileSync(join('/srv/themes', req.params.name)); }",
      filename: TS,
    },
    // A deny regex written at the test is a new object each time: `g` keeps no state there.
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; function h(req) { const n = basename(String(req.query.f)); if (/^\\.{1,2}$/g.test(n)) return; fs.rmSync(join(BASE, n), { recursive: true }); }",
      filename: TS,
    },
    // `@fastify/static` serves under its registered root, or a fixed root the call passes.
    {
      code: "function h(req, reply) { return reply.sendFile(req.params.file); }",
      filename: TS,
    },
    {
      code: "function h(req, reply) { return reply.sendFile(req.params.file, '/srv/static'); }",
      filename: TS,
    },
    {
      code: "function h(req, reply) { return reply.download(req.params.file, 'report.pdf', { root: '/srv/reports' }); }",
      filename: TS,
    },
    // A fresh sticky regex is anchored at index 0 and matches both dot segments.
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; function h(req) { const n = basename(String(req.query.f)); if (/^\\.{1,2}$/y.test(n)) return; fs.rmSync(join(BASE, n), { recursive: true }); }",
      filename: TS,
    },
  ],
  invalid: [
    // `req.*` straight into path.join with no guard.
    {
      code: `function h(req) { return path.join(baseDir, req.params.file); }`,
      filename: TS,
      errors: ERR,
    },
    // `request.*` into path.resolve.
    {
      code: `function h(request) { return path.resolve(base, request.query.path); }`,
      filename: TS,
      errors: ERR,
    },
    // An arrow handler at module scope.
    {
      code: `const h = (req) => path.join(base, req.body.name);`,
      filename: TS,
      errors: ERR,
    },
    // A configured request-object name.
    {
      code: `function h(ctx) { return path.join(base, ctx.params.x); }`,
      filename: TS,
      options: [{ requestObjects: ['ctx'] }],
      errors: ERR,
    },
    // A renderer-writable settings object configured as a source.
    {
      code: `import { join } from 'node:path'; import { rm } from 'node:fs/promises'; async function clearSprite(settings) { await rm(join(spritesDir, settings.mascotCustomSprite)); }`,
      filename: TS,
      options: [{ requestObjects: ['settings'] }],
      errors: ERR,
    },
    // `join` imported from `node:path`.
    {
      code: `import { join } from 'node:path'; function h(req) { return join(base, req.params.file); }`,
      filename: TS,
      errors: ERR,
    },
    // A renamed import from `path`.
    {
      code: `import { resolve as resolvePath } from 'path'; function h(req) { return resolvePath(base, req.params.file); }`,
      filename: TS,
      errors: ERR,
    },
    // A namespace import under another name.
    {
      code: `import * as nodePath from 'node:path'; function h(req) { return nodePath.join(base, req.params.file); }`,
      filename: TS,
      errors: ERR,
    },
    // A `.startsWith` on some other string is not a test of the joined value.
    {
      code: `function h(req) { const name = req.params.file; if (name.startsWith('.')) throw new Error('hidden'); return path.join(base, req.params.file); }`,
      filename: TS,
      errors: ERR,
    },
    // Normalizing the joined value tests nothing: `normalize` resolves `..` out of the base.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); return path.normalize(p); }`,
      filename: TS,
      errors: ERR,
    },
    // A test of a value read from the joined path (file content) is not containment.
    {
      code: `import { readFileSync } from 'node:fs'; function h(req) { const text = readFileSync(path.join(base, req.params.file), 'utf8'); if (!text.startsWith('#')) throw new Error('bad'); return text; }`,
      filename: TS,
      errors: ERR,
    },
    // A guard helper that is not configured does not count.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); assertInside(base, p); return p; }`,
      filename: TS,
      errors: ERR,
    },
    // fs sinks reached by request input through local data flow.
    {
      code: "const fs = require('fs'); function h(req, res) { const name = String(req.query.file).replace(/\\0/g, ''); res.send(fs.readFileSync('/srv/files/' + name, 'utf8')); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; function h(req) { const name = decodeURIComponent(req.query.id); fs.writeFileSync(`/srv/uploads/${name}`, 'data'); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const parts = []; for (const token of String(req.body.list).split(',')) { parts.push(token); } const name = parts.join(','); fs.unlinkSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { let name; try { name = JSON.parse(req.body.payload).value; } catch { name = String(req.body.payload); } fs.writeFileSync('/srv/uploads/' + name, 'x'); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const input = req.body?.field || ''; const payload = { get value() { return input; } }; const name = payload.value; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const capture = (v) => () => String(v).trim(); const read = capture(req.query.id); const name = read(); fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const { promises: fsp } = require('fs'); async function h(req) { const [name] = String(req.headers.authorization).split(','); await fsp.rm('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { createReadStream } from 'node:fs'; function h(req) { return createReadStream('/srv/files/' + req.params.file); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import * as fs from 'node:fs'; async function h(req) { await fs.promises.readFile('/srv/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { fs.renameSync('/srv/tmp/a', '/srv/files/' + req.body.to); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "function h(req, res) { res.sendFile('/srv/files/' + req.params.file); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; fs.readFileSync(name); }",
      filename: TS,
      errors: FS,
    },
    // Near misses of the guards.
    {
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; if (!/^[a-z0-9_./-]+$/.test(name)) return; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; if (!/[a-z]+/.test(name)) return; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; fs.readFileSync('/srv/files/' + name); if (!['a'].includes(name)) return; }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); const path = require('path'); function h(req) { const resolved = path.resolve('/srv/files', String(req.query.file)); fs.readFileSync(resolved); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const fs = require('fs'); function h(req) { const name = clean(req.query.file); fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    // A direct request argument to a join is reported once, at the join.
    {
      code: "const fs = require('fs'); function h(req) { fs.readFileSync(path.join(base, req.params.file)); }",
      filename: TS,
      errors: ERR,
    },
    // A table holding request data, and a schema field that is not confined.
    {
      code: "const fs = require('fs'); function h(req) { const FILES = { mine: req.body.name }; fs.unlinkSync('/srv/files/' + FILES[req.params.id]); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { z } from 'zod'; import fs from 'node:fs'; const Body = z.object({ theme: z.string() }); function h(req) { const { theme } = Body.parse(req.body); return fs.readFileSync(`/srv/themes/${theme}.css`); }",
      filename: TS,
      errors: FS,
    },
    // Near misses: no early return, a list that is mutated, the member written after the check, another member checked, a regex.
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) res.status(404); return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; allowed.push(req.query.extra); if (!allowed.includes(req.params.name)) return res.end(); return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); req.params.name = req.query.other; return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); Object.assign(req.params, req.query); return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.other)) return res.end(); return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { if (!/^[a-z.]+$/.test(req.params.name)) return res.end(); return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    // `startsWith(base)` without a separator admits `/srv/app-evil` for `/srv/app`.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); if (!p.startsWith(base)) throw new Error('bad'); return p; }`,
      filename: TS,
      errors: ERR,
    },
    {
      code: `import { join, normalize } from 'node:path'; function h(req) { const p = normalize(join(base, req.params.file)); if (!p.startsWith(base)) throw new Error('bad'); return p; }`,
      filename: TS,
      errors: ERR,
    },
    // A relative check without `isAbsolute` misses an absolute result on Windows (another drive).
    {
      code: `function h(req) { const p = path.resolve(base, req.params.file); const rel = path.relative(base, p); if (rel.startsWith('..')) throw new Error('bad'); return p; }`,
      filename: TS,
      errors: ERR,
    },
    // A bare `basename` is not containment: `basename('..')` is `'..'`.
    {
      code: "const fs = require('fs'); const path = require('path'); function h(req) { const name = String(req.query.file); return fs.readFileSync('/srv/files/' + path.basename(name)); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { basename } from 'node:path'; import { readFile } from 'node:fs/promises'; async function h(req) { return readFile(`/srv/files/${basename(req.query.file)}`); }",
      filename: TS,
      errors: FS,
    },
    // A regex that admits `..` is not a path segment proof.
    {
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; if (!/^[a-z0-9_.-]+$/i.test(name)) return; fs.readFileSync('/srv/files/' + name); }",
      filename: TS,
      errors: FS,
    },
    // The probes from the review: a bare basename lets `..` through.
    {
      code: "import { basename, join } from 'node:path'; import { readFileSync } from 'node:fs'; function h(req) { return readFileSync(join(BASE, basename(req.query.u), 'profile.json')); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { basename, join } from 'node:path'; import { rmSync } from 'node:fs'; function h(req) { rmSync(join(BASE, basename(req.query.u)), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    // A check that refuses only `.`, or runs after the sink, or on another value.
    {
      code: "import { basename, join } from 'node:path'; import { rmSync } from 'node:fs'; function h(req) { const name = basename(req.query.u); if (name === '.') return; rmSync(join(BASE, name), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { basename, join } from 'node:path'; import { rmSync } from 'node:fs'; function h(req) { const name = basename(req.query.u); rmSync(join(BASE, name), { recursive: true }); if (name === '..') return; }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { basename, join } from 'node:path'; import { rmSync } from 'node:fs'; function h(req) { let name = basename(req.query.u); if (name === '..') return; name = req.query.v; rmSync(join(BASE, name)); }",
      filename: TS,
      errors: FS,
    },
    // A dot check on a basename, then a decode: `%2e%2e` passes and decodes to `..`.
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; function h(req) { const name = basename(req.query.f); if (name === '..' || name === '.') return; fs.readFileSync(join(BASE, decodeURIComponent(name))); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; function h(req) { const name = req.query.f; if (!/^[\\w%-][\\w.%-]*$/.test(name)) return; fs.readFileSync('/srv/files/' + decodeURIComponent(name)); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; function h(req) { const name = req.query.f; if (!/^[\\w-][\\w.-]*$/.test(name)) return; fs.readFileSync('/srv/files/' + Buffer.from(name, 'base64').toString()); }",
      filename: TS,
      errors: FS,
    },
    // A string method can turn checked text into `..`.
    {
      code: "import fs from 'node:fs'; function h(req) { const name = req.query.f; if (!/^[\\w-][\\w.-]*$/.test(name)) return; fs.rmSync('/srv/files/' + name.slice(1), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; function h(req) { const name = req.query.f; if (!/^[\\w-][\\w-]*$/.test(name)) return; fs.rmSync('/srv/files/' + name.replace(/_/g, '.'), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    // `resolve` with an absolute segment ignores the base; a test that does not dominate the sink.
    {
      code: "import { resolve, sep } from 'node:path'; import fs from 'node:fs'; function h(req) { const full = resolve(BASE, req.query.f); fs.readFileSync(full); if (!full.startsWith(BASE + sep)) return; }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { resolve, sep } from 'node:path'; import fs from 'node:fs'; function h(req) { const full = resolve(BASE, req.query.f); if (full.startsWith(BASE + sep)) log('inside'); fs.readFileSync(full); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { resolve, sep } from 'node:path'; import fs from 'node:fs'; function h(req) { const full = resolve(BASE, req.query.f); full.startsWith(BASE + sep); fs.readFileSync(full); }",
      filename: TS,
      errors: FS,
    },
    // `startsWith(base)` without a separator before an fs sink.
    {
      code: "import { resolve } from 'node:path'; import fs from 'node:fs'; function h(req) { const name = req.query.f; const full = resolve('/srv/app', name); if (!full.startsWith('/srv/app')) return; fs.readFileSync(full); }",
      filename: TS,
      errors: FS,
    },
    // A test on the first segment does not cover a second request segment joined after it.
    {
      code: "import { resolve, join, sep } from 'node:path'; import fs from 'node:fs'; function h(req) { const dir = resolve(BASE, String(req.params.d)); if (!dir.startsWith(BASE + sep)) return; const file = join(dir, String(req.query.f)); fs.readFileSync(file); }",
      filename: TS,
      errors: FS,
    },
    // A reassigned resolved path is not the tested one.
    {
      code: "import { resolve, sep } from 'node:path'; import fs from 'node:fs'; function h(req) { let full = resolve(BASE, String(req.query.f)); if (!full.startsWith(BASE + sep)) return; full = String(req.query.g); fs.readFileSync(full); }",
      filename: TS,
      errors: FS,
    },
    // `relative` refused only for `..`, or only for absolute.
    {
      code: "import { resolve, relative, isAbsolute } from 'node:path'; import fs from 'node:fs'; function h(req) { const full = resolve(BASE, String(req.query.f)); const rel = relative(BASE, full); if (isAbsolute(rel)) return; fs.readFileSync(full); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { resolve, relative } from 'node:path'; import fs from 'node:fs'; function h(req) { const full = resolve(BASE, String(req.query.f)); if (relative(BASE, full).startsWith('..')) return; fs.readFileSync(full); }",
      filename: TS,
      errors: FS,
    },
    // `normalize` keeps a leading `..`.
    {
      code: "import { normalize } from 'node:path'; import fs from 'node:fs'; function h(req) { fs.readFileSync('/srv/files/' + normalize(req.query.f)); }",
      filename: TS,
      errors: FS,
    },
    // `path.posix.basename` does not strip `\\` and is not a sanitizer.
    {
      code: "import path from 'node:path'; import fs from 'node:fs'; function h(req) { const name = path.posix.basename(req.query.f); if (name.startsWith('.')) return; fs.readFileSync(path.join(BASE, name)); }",
      filename: TS,
      errors: FS,
    },
    // New sinks: existsSync, watch, statfs, glob.
    {
      code: "import { existsSync } from 'node:fs'; function h(req) { return existsSync('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; function h(req) { fs.watch('/srv/files/' + req.query.f, () => {}); }",
      filename: TS,
      errors: FS,
    },
    // Dynamic import, awaited and destructured, inside the handler; `require` inline; aliases.
    {
      code: "async function h(req) { const fs = await import('node:fs'); fs.readFileSync('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "async function h(req) { const { readFile } = await import('fs'); await readFile('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "async function h(req) { const { promises } = await import('node:fs'); await promises.rm('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "function h(req) { require('fs').readFileSync('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "const { readFile } = require('fs').promises; async function h(req) { await readFile('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import * as nodeFs from 'node:fs'; const p = nodeFs.promises; const { unlink } = p; async function h(req) { await unlink('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs = require('fs'); function h(req) { fs.readFileSync('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    // TS wrappers and a computed key on the callee.
    {
      code: "import fs from 'node:fs'; function h(req) { (fs as any).readFileSync('/srv/files/' + req.query.f); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; function h(req) { fs['readFileSync']('/srv/files/' + (req.query.f satisfies unknown)); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { join } from 'node:path'; function h(req) { return join(BASE, req.query.f as string); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req) { return join(BASE, req.query?.f!); }",
      filename: TS,
      errors: ERR,
    },
    // Express without `root`, and a root taken from the request.
    {
      code: "function h(req, res) { res.sendFile(req.params.file, { maxAge: 0 }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "function h(req, res) { res.sendFile('index.html', { root: req.query.dir }); }",
      filename: TS,
      errors: FS,
    },
    // A local helper that forwards its parameter to an fs sink.
    {
      code: "import fs from 'node:fs'; function load(p) { return fs.readFileSync('/srv/files/' + p); } function h(req) { return load(req.query.f); }",
      filename: TS,
      errors: [{ messageId: 'unguardedFsHelper' as const }],
    },
    {
      code: "import { rm } from 'node:fs/promises'; import { join } from 'node:path'; const remove = async (dir, name) => { await rm(join(dir, name), { recursive: true }); }; async function h(req) { const { name } = req.body; await remove('/srv/files', name); }",
      filename: TS,
      errors: [{ messageId: 'unguardedFsHelper' as const }],
    },
    // Destructured handler parameters.
    {
      code: "import { readFile } from 'node:fs/promises'; const h = async ({ query }) => readFile('/srv/files/' + query.f);",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { readFile } from 'node:fs/promises'; const h = async ({ params: { f } }, res) => res.send(await readFile('/srv/files/' + f));",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { readFile } from 'node:fs/promises'; async function h({ body: { name: n } = {} }) { return readFile('/srv/files/' + n); }",
      filename: TS,
      errors: FS,
    },
    // A request object destructured in the body.
    {
      code: "import fs from 'node:fs'; function h(req) { const { query } = req; fs.readFileSync('/srv/files/' + query.f); }",
      filename: TS,
      errors: FS,
    },
    // An allowlisted member changed through an alias, a computed key, a type wrapper, or a call.
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); const p = req.params; p.name = req.query.other; return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res, key) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); req.params[key] = req.query.other; return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); (req.params as any).name = req.query.other; return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); mutate(req); return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    {
      code: "import { join } from 'node:path'; function h(req, res) { const allowed = ['a.html']; if (!allowed.includes(req.params.name)) return res.end(); const { params } = req; params.name = '..'; return join('/srv', req.params.name); }",
      filename: TS,
      errors: ERR,
    },
    // A dot check on a file name does not carry over to its stem: `'...'` passes and its stem is `..`.
    {
      code: "import fs from 'node:fs'; import path from 'node:path'; function h(req, res) {\n  const file = path.basename(req.file.originalname);\n  if (file === '.' || file === '..') return res.status(400).end();\n  const { name } = path.parse(file);\n  fs.rmSync(path.join(B, name), { recursive: true });\n}",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; import { basename, extname, join } from 'node:path'; function h(req) {\n  const file = basename(String(req.query.f));\n  if (file === '.' || file === '..') return;\n  fs.readFileSync(join(B, basename(file, extname(file)), 'meta.json'));\n}",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; import { basename, join } from 'node:path'; function h(req) { const file = basename(String(req.query.f)); if (file === '.' || file === '..') return; fs.rmSync(join(B, basename(file, '.')), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    // Any other call or a member read on the checked value: `_.trim`, `new URL`, `path.parse(...).name`.
    {
      code: "import fs from 'node:fs'; import { basename, join } from 'node:path'; import _ from 'lodash'; function h(req) { const n = basename(String(req.query.f)); if (n === '.' || n === '..') return; fs.rmSync(join(B, _.trim(n)), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; import { basename } from 'node:path'; function h(req) { const n = basename(String(req.query.f)); if (n === '.' || n === '..') return; fs.rmSync(new URL(n, 'file:///srv/files/'), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import fs from 'node:fs'; import path from 'node:path'; function h(req) { const n = req.query.f; if (!/^[\\w-][\\w.-]*$/.test(n)) return; fs.rmSync(path.join(B, path.parse(n).name), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    // A shared `g` or `y` deny regex keeps `lastIndex`: `DOTS.test('..')` alternates.
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; const DOTS = /^\\.{1,2}$/g; function h(req) { const n = basename(String(req.query.f)); if (DOTS.test(n)) return; fs.rmSync(join(BASE, n), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; const DOTS = /^\\.{1,2}$/y; function h(req) { const n = basename(String(req.query.f)); if (DOTS.test(n)) return; fs.rmSync(join(BASE, n), { recursive: true }); }",
      filename: TS,
      errors: FS,
    },
    // A Fastify root the call takes from the request.
    {
      code: "function h(req, reply) { return reply.sendFile('index.html', req.query.dir); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "function h(req, reply) { return reply.sendFile('index.html', { root: req.query.dir }); }",
      filename: TS,
      errors: FS,
    },
    {
      code: "function h(req, reply) { return reply.download('a.pdf', { root: req.query.dir }); }",
      filename: TS,
      errors: FS,
    },
    // A fresh sticky regex is anchored at index 0: `/\.$/y.test('..')` is false.
    {
      code: "import { basename, join } from 'node:path'; import fs from 'node:fs'; function h(req) {\n  const n = basename(String(req.query.f));\n  if (/\\.$/y.test(n)) return;\n  fs.rmSync(join(B, n), { recursive: true });\n}",
      filename: TS,
      errors: FS,
    },
  ],
});
