import { ruleTester } from '@noctcore/eslint-test-utils';

import { requirePathContainmentRule } from '../../src/rules/require-path-containment';

const TS = 'handler.ts';

ruleTester.run('require-path-containment', requirePathContainmentRule, {
  valid: [
    // No request-shaped input.
    { code: `path.join(baseDir, 'static.txt');`, filename: TS },
    // A sanitized local (not a direct `req.*` argument) is not flagged.
    {
      code: `function h(req) { const safe = clean(req.params.file); return path.join(base, safe); }`,
      filename: TS,
    },
    // A `.startsWith` containment guard in the same function suppresses.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); if (!p.startsWith(base)) throw new Error('bad'); return p; }`,
      filename: TS,
    },
    // A `path.normalize` guard suppresses.
    {
      code: `function h(req) { const p = path.join(base, req.params.file); return path.normalize(p); }`,
      filename: TS,
    },
    // The escape-hatch comment convention suppresses.
    {
      code: `function h(req) {\n  // path-containment: base is a fixed constant, req.params.file is validated upstream\n  return path.join(base, req.params.file);\n}`,
      filename: TS,
    },
    // A bare `req` (not a member expression) is not the tracked sink.
    { code: `function h(req) { return path.resolve(base, req); }`, filename: TS },
  ],
  invalid: [
    // `req.*` straight into path.join with no guard.
    {
      code: `function h(req) { return path.join(baseDir, req.params.file); }`,
      filename: TS,
      errors: [{ messageId: 'unguardedPathJoin' }],
    },
    // `request.*` into path.resolve.
    {
      code: `function h(request) { return path.resolve(base, request.query.path); }`,
      filename: TS,
      errors: [{ messageId: 'unguardedPathJoin' }],
    },
    // An arrow handler at module scope.
    {
      code: `const h = (req) => path.join(base, req.body.name);`,
      filename: TS,
      errors: [{ messageId: 'unguardedPathJoin' }],
    },
    // A configured request-object name.
    {
      code: `function h(ctx) { return path.join(base, ctx.params.x); }`,
      filename: TS,
      options: [{ requestObjects: ['ctx'] }],
      errors: [{ messageId: 'unguardedPathJoin' }],
    },
  ],
});
