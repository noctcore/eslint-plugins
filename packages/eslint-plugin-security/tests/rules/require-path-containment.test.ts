import { ruleTester } from '@noctcore/eslint-test-utils';

import { requirePathContainmentRule } from '../../src/rules/require-path-containment';

const TS = 'handler.ts';
const ERR = [{ messageId: 'unguardedPathJoin' as const }];

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
  ],
});
