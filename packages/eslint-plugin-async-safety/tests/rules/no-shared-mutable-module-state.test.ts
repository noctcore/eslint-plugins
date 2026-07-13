import { ruleTester } from '@noctcore/eslint-test-utils';

import { noSharedMutableModuleStateRule } from '../../src/rules/no-shared-mutable-module-state';

const SERVER = 'src/server/route.ts';
const INCLUDE = [{ include: ['**/server/**'] }];

ruleTester.run('no-shared-mutable-module-state', noSharedMutableModuleStateRule, {
  valid: [
    // Off by default: no `include`, so nothing fires even on a server file.
    {
      code: `let count = 0; export async function GET() { count++; }`,
      filename: SERVER,
    },
    // Armed, but the write lives in a non-exported helper.
    {
      code: `let count = 0; function helper() { count++; } export async function GET() { helper(); }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // Armed, but the module const is only read.
    {
      code: `const CONFIG = { a: 1 }; export async function GET() { return CONFIG.a; }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // Lazy singleton idiom (`??=`) is always skipped.
    {
      code: `let instance; export async function get() { instance ??= create(); return instance; }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // Allowlisted binding.
    {
      code: `let cache = {}; export async function GET() { cache.x = 1; }`,
      filename: SERVER,
      options: [{ include: ['**/server/**'], allow: ['cache'] }],
    },
    // A file that does not match the include glob.
    {
      code: `let count = 0; export async function GET() { count++; }`,
      filename: 'src/client/widget.ts',
      options: INCLUDE,
    },
    // Written inside an exported-but-non-async, non-handler function.
    {
      code: `let count = 0; export function tally() { count++; }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // Immutable const.
    {
      code: `const MAX = 5; export async function GET() { return MAX; }`,
      filename: SERVER,
      options: INCLUDE,
    },
  ],
  invalid: [
    // Reassigned module `let` inside an exported async function.
    {
      code: `let count = 0; export async function GET() { count += 1; }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'count', fn: 'GET' } }],
    },
    // Container mutation via push.
    {
      code: `const requests = []; export async function POST() { requests.push(1); }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'requests', fn: 'POST' } }],
    },
    // Handler-named export (loader).
    {
      code: `let current = null; export async function loader() { current = await load(); }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'current', fn: 'loader' } }],
    },
    // Exported async arrow, Map mutation.
    {
      code: `const store = new Map(); export const handler = async () => { store.set('k', 1); };`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'store', fn: 'handler' } }],
    },
    // Default export.
    {
      code: `let hits = 0; export default async function () { hits++; }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'hits', fn: 'default export' } }],
    },
    // `*.server.ts` include pattern.
    {
      code: `let n = 0; export async function GET() { n++; }`,
      filename: 'src/db.server.ts',
      options: [{ include: ['**/*.server.ts'] }],
      errors: [{ messageId: 'sharedMutableState', data: { name: 'n', fn: 'GET' } }],
    },
  ],
});
