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
    // A class that is not exported is not an entry point.
    {
      code: `let cache = {}; class Local { set(k, v) { cache[k] = v; } }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // The constructor runs at wiring time, not per request.
    {
      code: `let instances = 0; export class Service { constructor() { instances++; } }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // Instance state on a provider is not a module binding.
    {
      code: `export class CacheService { private readonly cache = new Map(); set(k: string, v: unknown) { this.cache.set(k, v); } }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // Lazy init inside a method is the singleton idiom.
    {
      code: `let client; export class Db { get() { client ??= connect(); return client; } }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // A method only reading a module const.
    {
      code: `const LIMITS = { max: 10 }; export class Q { max() { return LIMITS.max; } }`,
      filename: SERVER,
      options: INCLUDE,
    },
    // An abstract method has no body.
    {
      code: `let n = 0; export abstract class Base { abstract run(): void; }`,
      filename: SERVER,
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
    // A method of an exported class, the NestJS service shape.
    {
      code: `let cache = {}; export class S { set(k, v) { cache[k] = v; } }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'cache', fn: 'S.set' } }],
    },
    {
      code: `import { Injectable } from '@nestjs/common';
const seen = new Set<string>();
let lastTenant: string | undefined;
@Injectable()
export class TenantService {
  async remember(tenantId: string) {
    lastTenant = tenantId;
    seen.add(tenantId);
  }
}`,
      filename: SERVER,
      options: INCLUDE,
      errors: [
        { messageId: 'sharedMutableState', data: { name: 'lastTenant', fn: 'TenantService.remember' } },
        { messageId: 'sharedMutableState', data: { name: 'seen', fn: 'TenantService.remember' } },
      ],
    },
    // A class exported by a later statement.
    {
      code: `let count = 0; class Counter { bump() { count++; } } export { Counter };`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'count', fn: 'Counter.bump' } }],
    },
    // A default-exported class, a class expression, an arrow property and a private method.
    {
      code: `let n = 0; export default class { run() { n++; } }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'n', fn: 'default export.run' } }],
    },
    {
      code: `const log = []; export const Svc = class { handle = () => { log.push(1); }; };`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'log', fn: 'Svc.handle' } }],
    },
    {
      code: `let n = 0; export class Svc { #bump() { n++; } run() { this.#bump(); } }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'n', fn: 'Svc.#bump' } }],
    },
    // A write in a callback inside a method.
    {
      code: `const queue = []; export class Worker { start(items) { items.forEach((i) => queue.push(i)); } }`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'queue', fn: 'Worker.start' } }],
    },
    // An async function exported by a later statement.
    {
      code: `let hits = 0; async function GET() { hits++; } export { GET };`,
      filename: SERVER,
      options: INCLUDE,
      errors: [{ messageId: 'sharedMutableState', data: { name: 'hits', fn: 'GET' } }],
    },
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
