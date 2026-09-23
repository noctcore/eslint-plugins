import { ruleTester } from '@noctcore/eslint-test-utils';

import { noTimingUnsafeCompareRule } from '../../src/rules/no-timing-unsafe-compare';

const TS = 'webhook.ts';

ruleTester.run('no-timing-unsafe-compare', noTimingUnsafeCompareRule, {
  valid: [
    // The fix: a constant-time comparison.
    {
      code: `const expected = createHmac('sha256', key).update(body).digest();
const given = Buffer.from(signature, 'hex');
if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error();`,
      filename: TS,
    },
    // Unkeyed hashes are not secrets: ETags, cache keys, integrity checks.
    { code: `if (createHash('sha256').update(body).digest('hex') === etag) {}`, filename: TS },
    { code: `const key = crypto.createHash('md5').update(url).digest('hex'); if (cache.key === key) {}`, filename: TS },
    // A secret against a static value: nothing forged to measure.
    { code: `if (createHmac('sha1', k).digest('hex') === undefined) {}`, filename: TS },
    { code: `if (createHmac('sha256', k).update(b).digest('hex') !== '') {}`, filename: TS },
    { code: `if (createHmac('sha256', k).digest('hex') == null) {}`, filename: TS },
    { code: 'if (createHmac(`sha256`, k).digest(`hex`) === `abc`) {}', filename: TS },
    // Double HMAC: both sides secret is the documented mitigation.
    {
      code: `const a = createHmac('sha256', k).update(x).digest('hex');
const b = createHmac('sha256', k).update(y).digest('hex');
if (a === b) {}`,
      filename: TS,
    },
    // The length guard itself.
    { code: `const d = createHmac('sha256', k).digest(); if (d.length !== sig.length) {}`, filename: TS },
    // Name-based guessing is not provenance.
    { code: `if (token === providedToken) {}`, filename: TS },
    { code: `if (password === undefined) {}`, filename: TS },
    { code: `if (signature === expectedSignature) {}`, filename: TS },
    // `.digest` on something that is not an HMAC chain.
    { code: `if (report.digest() === other) {}`, filename: TS },
    { code: `if (hasher.update(a).digest('hex') === b) {}`, filename: TS },
    // A `let` can be reassigned: not proof.
    { code: `let h = createHmac('sha256', k); if (h.digest('hex') === sig) {}`, filename: TS },
    // `sign` on something that is not Web Crypto.
    { code: `if (jwt.sign(payload, key) === token) {}`, filename: TS },
    // `.equals` between two secrets, and on non-secrets.
    {
      code: `const a = createHmac('sha256', k).update(x).digest();
const b = createHmac('sha256', k).update(y).digest();
a.equals(b);`,
      filename: TS,
    },
    { code: `a.equals(b);`, filename: TS },
    // Configured sources only match what they name.
    {
      code: `if (process.env.API_KEY === undefined) {}`,
      filename: TS,
      options: [{ secretSources: ['process.env.API_KEY'] }],
    },
    {
      code: `if (process.env.NODE_ENV === mode) {}`,
      filename: TS,
      options: [{ secretSources: ['process.env.API_KEY'] }],
    },
    // Other operators.
    { code: `if (createHmac('sha256', k).digest().length > n) {}`, filename: TS },
  ],
  invalid: [
    // The webhook signature check, inline.
    {
      code: `if (createHmac('sha256', secret).update(body).digest('hex') !== signature) throw new Error();`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare', data: { operator: '!==' } }],
    },
    // Through `crypto.` and a const.
    {
      code: `const expected = crypto.createHmac('sha256', secret).update(raw).digest('base64');
return expected === req.headers['x-signature'];`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare', data: { operator: '===' } }],
    },
    // A const HMAC object fed by statements.
    {
      code: `const hmac = createHmac('sha256', secret);
hmac.update(body);
return signature == hmac.digest('hex');`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare', data: { operator: '==' } }],
    },
    // Re-encoded.
    {
      code: `const mac = createHmac('sha1', k).update(b).digest(); if (mac.toString('hex') != sig) {}`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare', data: { operator: '!=' } }],
    },
    {
      code: `if (createHmac('sha1', k).digest('hex').toLowerCase() === header.toLowerCase()) {}`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare' }],
    },
    // Web Crypto.
    {
      code: `const sig = await crypto.subtle.sign('HMAC', key, data);
if (Buffer.from(sig).toString('hex') === provided) {}`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare' }],
    },
    // Buffer#equals is not constant-time either.
    {
      code: `const expected = createHmac('sha256', k).update(b).digest(); if (!expected.equals(Buffer.from(sig, 'hex'))) {}`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare', data: { operator: '.equals()' } }],
    },
    {
      code: `if (given.equals(new Uint8Array(await subtle.sign('HMAC', key, data)))) {}`,
      filename: TS,
      errors: [{ messageId: 'timingUnsafeCompare', data: { operator: '.equals()' } }],
    },
    // Configured secret sources.
    {
      code: `if (req.headers['x-api-key'] !== process.env.API_KEY) {}`,
      filename: TS,
      options: [{ secretSources: ['process.env.API_KEY'] }],
      errors: [{ messageId: 'timingUnsafeCompare' }],
    },
    {
      code: `if (token === getAdminToken()) {}`,
      filename: TS,
      options: [{ secretSources: ['getAdminToken()'] }],
      errors: [{ messageId: 'timingUnsafeCompare' }],
    },
  ],
});
