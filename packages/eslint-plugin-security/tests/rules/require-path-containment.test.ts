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
    // A `.startsWith` test of the joined value suppresses.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); if (!p.startsWith(base)) throw new Error('bad'); return p; }`,
      filename: TS,
    },
    // A test of a variable derived from the joined value through a path call.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); const n = path.normalize(p); if (!n.startsWith(base + path.sep)) throw new Error('bad'); return n; }`,
      filename: TS,
    },
    // Stored through a wrapping path call.
    {
      code: `import { join, normalize } from 'node:path'; function h(req) { const p = normalize(join(base, req.params.file)); if (!p.startsWith(base)) throw new Error('bad'); return p; }`,
      filename: TS,
    },
    // `path.relative(base, joined)` is a containment test.
    {
      code: `function h(req) { const p = path.resolve(base, req.params.file); const rel = path.relative(base, p); if (rel.startsWith('..')) throw new Error('bad'); return p; }`,
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
      code: "const fs = require('fs'); const path = require('path'); function h(req) { const name = String(req.query.file); return fs.readFileSync('/srv/files/' + path.basename(name)); }",
      filename: TS,
    },
    {
      code: "import { basename } from 'node:path'; import { readFile } from 'node:fs/promises'; async function h(req) { return readFile(`/srv/files/${basename(req.query.file)}`); }",
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
      code: "const fs = require('fs'); function h(req) { const name = req.query.file; if (!/^[a-z0-9_.-]+$/i.test(name)) return; fs.readFileSync('/srv/files/' + name); }",
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
  ],
});
