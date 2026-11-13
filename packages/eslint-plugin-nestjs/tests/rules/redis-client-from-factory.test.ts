import { ruleTester } from '@noctcore/eslint-test-utils';

import { redisClientFromFactoryRule } from '../../src/rules/redis-client-from-factory';

const IMPORT = `import { Queue, Worker } from 'bullmq';\n`;
const FACTORY = { factoryFunctions: ['getRedisOptions'] };
const WITH_FACTORY = [FACTORY];

ruleTester.run('redis-client-from-factory', redisClientFromFactoryRule, {
  valid: [
    { name: 'factory call', code: `new Redis(getRedisOptions());`, options: WITH_FACTORY },
    {
      name: 'factory spread',
      code: `new Redis({ ...getRedisOptions(), db: 1 });`,
      options: WITH_FACTORY,
    },
    {
      name: 'member factory call',
      code: `new Redis(this.redis.getRedisOptions());`,
      options: WITH_FACTORY,
    },
    {
      name: 'factory call with a type assertion',
      code: `new Redis(getRedisOptions() as RedisOptions);`,
      options: WITH_FACTORY,
    },
    {
      name: 'url beside factory options',
      code: `new Redis(url, getRedisOptions());`,
      options: WITH_FACTORY,
    },
    { name: 'identifier argument', code: `new Redis(options);`, options: WITH_FACTORY },
    { name: 'member argument', code: `new Redis(this.options);`, options: WITH_FACTORY },
    { name: 'spread argument', code: `new Redis(...args);`, options: WITH_FACTORY },
    {
      name: 'class not in clientClasses',
      code: `new Redis({ host });`,
      options: [{ ...FACTORY, clientClasses: ['Cache'] }],
    },
    { name: 'member constructor', code: `new Redis.Cluster([{ host }]);`, options: WITH_FACTORY },
    {
      name: 'connection from the factory',
      code: `${IMPORT}new Queue('mail', { connection: getRedisOptions() });`,
      options: WITH_FACTORY,
    },
    {
      name: 'connection spreads the factory',
      code: `${IMPORT}new Queue('mail', { connection: { ...getRedisOptions(), maxRetriesPerRequest: null } });`,
      options: WITH_FACTORY,
    },
    {
      name: 'connection shorthand identifier',
      code: `${IMPORT}new Queue('mail', { connection });`,
      options: WITH_FACTORY,
    },
    {
      name: 'connection identifier value',
      code: `${IMPORT}new Queue('mail', { connection: redis });`,
      options: WITH_FACTORY,
    },
    {
      name: 'connection client from the factory',
      code: `${IMPORT}new Queue('mail', { connection: new Redis(getRedisOptions()) });`,
      options: WITH_FACTORY,
    },
    {
      name: 'queue without a bullmq import',
      code: `new Queue('mail', { connection: { host } });`,
      options: WITH_FACTORY,
    },
    {
      name: 'queue from another module',
      code: `import { Queue } from './queue';\nnew Queue('mail', { connection: { host } });`,
      options: WITH_FACTORY,
    },
    {
      name: 'local class shadows the import',
      code: `${IMPORT}function make() {\n  class Queue {}\n  return new Queue('mail', { connection: { host } });\n}`,
      options: WITH_FACTORY,
    },
    {
      name: 'type-only import',
      code: `import type { Queue } from 'bullmq';\nnew Queue('mail', { connection: { host } });`,
      options: WITH_FACTORY,
    },
    {
      name: 'options by name',
      code: `${IMPORT}new Queue('mail', queueOptions);`,
      options: WITH_FACTORY,
    },
    {
      name: 'worker options in the second slot',
      code: `${IMPORT}new Worker('mail', { connection: { host } });`,
      options: WITH_FACTORY,
    },
    { name: 'no options', code: `new Redis({ host });` },
    {
      name: 'empty factoryFunctions',
      code: `new Redis({ host });`,
      options: [{ factoryFunctions: [] }],
    },
    {
      name: 'default test file',
      code: `new Redis({ host });`,
      filename: 'src/cache.test.ts',
      options: WITH_FACTORY,
    },
    {
      name: 'default __tests__ directory',
      code: `new Redis({ host });`,
      filename: 'src/__tests__/cache.ts',
      options: WITH_FACTORY,
    },
    {
      name: 'custom allowIn',
      code: `new Redis({ host });`,
      filename: 'src/redis/factory.ts',
      options: [{ ...FACTORY, allowIn: ['src/redis/**'] }],
    },
  ],
  invalid: [
    {
      name: 'no argument',
      code: `new Redis();`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient', data: { name: 'Redis' } }],
    },
    {
      name: 'url string',
      code: `new Redis('redis://localhost:6379');`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'template literal',
      code: 'new Redis(`redis://${host}`);',
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'port and host',
      code: `new Redis(6379, 'cache');`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'unlisted call',
      code: `new Redis(loadConfig());`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'unlisted member call',
      code: `new Redis(config.get('redis'));`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'object literal without a factory spread',
      code: `new Redis({ host: 'localhost', port: 6379 });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'spread of an unlisted call',
      code: `new Redis({ ...loadConfig() });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'IORedis default class',
      code: `new IORedis({ host });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient', data: { name: 'IORedis' } }],
    },
    {
      name: 'custom clientClasses',
      code: `new Cache({ host });`,
      options: [{ ...FACTORY, clientClasses: ['Cache'] }],
      errors: [{ messageId: 'inlineClient', data: { name: 'Cache' } }],
    },
    {
      name: 'queue inline connection',
      code: `${IMPORT}new Queue('mail', { connection: { host: 'localhost' } });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineConnection', line: 2, column: 33 }],
    },
    {
      name: 'worker inline connection',
      code: `${IMPORT}new Worker('mail', handler, { connection: { host: 'localhost' } });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineConnection' }],
    },
    {
      name: 'renamed import',
      code: `import { Queue as BullQueue } from 'bullmq';\nnew BullQueue('mail', { connection: { host } });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineConnection' }],
    },
    {
      name: 'connection spreads an unlisted call',
      code: `${IMPORT}new Queue('mail', { connection: { ...loadConfig() } });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineConnection' }],
    },
    {
      name: 'nested client reported once',
      code: `${IMPORT}new Queue('mail', { connection: new Redis({ host }) });`,
      options: WITH_FACTORY,
      errors: [{ messageId: 'inlineClient' }],
    },
    {
      name: 'custom allowIn replaces the default',
      code: `new Redis({ host });`,
      filename: 'src/cache.test.ts',
      options: [{ ...FACTORY, allowIn: ['src/redis/**'] }],
      errors: [{ messageId: 'inlineClient' }],
    },
  ],
});
