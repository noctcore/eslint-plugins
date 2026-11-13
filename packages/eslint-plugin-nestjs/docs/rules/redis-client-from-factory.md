# `noctcore-nestjs/redis-client-from-factory`

> Every Redis client and every inline BullMQ `connection` takes its options from a configured factory function.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · ⚙️ Needs options (see Options) · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A Redis connection written out where it is used drifts. One client gets the TLS flag, the retry
policy or the password from config, and the next one keeps a literal host and port that worked on a
laptop. BullMQ makes it worse: a `Queue` and a `Worker` each open their own connection, and a
`Worker` needs `maxRetriesPerRequest: null` that a plain client does not. Building every set of
options in one function keeps them the same:

```ts bad options={"factoryFunctions":["getRedisOptions"]}
import { Queue } from 'bullmq';

const cache = new Redis('redis://localhost:6379');
const jobs = new Queue('mail', { connection: { host: 'localhost', port: 6379 } });
```

Take the options from the factory, directly or as a spread:

```ts good options={"factoryFunctions":["getRedisOptions"]}
import { Queue } from 'bullmq';

const cache = new Redis(getRedisOptions());
const sessions = new Redis({ ...getRedisOptions(), db: 1 });
const jobs = new Queue('mail', { connection: getRedisOptions() });
```

## What it flags

With `factoryFunctions` set, a factory call is a call whose callee name is listed, so
`getRedisOptions()` and `this.redis.getRedisOptions()` both count.

- `new <C>(...)` for every `C` in `clientClasses` (default `Redis`, `IORedis`, matched by the callee
  identifier) with no argument, or whose arguments are all inline: a string or template literal, a
  call to a function that is not listed, or an object literal with no spread of a factory call.
  `new Redis(url, getRedisOptions())` is accepted, `new Redis(6379, 'cache')` is not.
- The `connection: { ... }` object literal in the options of a `new Queue(name, options)` or
  `new Worker(name, processor, options)` imported from `bullmq` (renamed imports included) that has
  no spread of a factory call.

A `connection: new Redis({ ... })` is reported once, on the client.

```ts bad options={"factoryFunctions":["getRedisOptions"]}
import { Worker } from 'bullmq';

const redis = new Redis();
const cache = new Redis({ host: 'localhost', port: 6379 });
const other = new Redis({ ...loadConfig() });
const worker = new Worker('mail', handler, { connection: { host: 'localhost' } });
```

## What it does not flag

- An identifier or member expression passed as the options or as `connection` (`new Redis(options)`,
  `{ connection }`, `{ connection: this.redis }`). The rule has no type information and does not
  follow a variable to where it was built.
- A client call with several arguments where one is a factory call, a factory spread, or a value the
  rule cannot see into (an identifier, a member expression, a spread argument): such a call is
  accepted, so `new Redis('redis://cache', getRedisOptions())` and `new Redis('redis://cache', options)`
  pass. Only a call whose arguments are all inline is reported.
- `new Redis.Cluster(...)` and other member constructors: classes are matched by the callee
  identifier only.
- `BullModule.forRoot({ connection })`, `QueueEvents` and `FlowProducer` connections.
- A `Queue` or `Worker` that is not bound to a `bullmq` import, such as a class of your own with
  the same name.
- Files matching `allowIn`, which by default are test files.
- Any file, while `factoryFunctions` is unset or empty.

```ts good options={"factoryFunctions":["getRedisOptions"]}
import { Queue } from 'bullmq';

const a = new Redis(options);
const b = new Redis(this.options);
const c = new Redis.Cluster([{ host: 'cache' }]);
const d = new Queue('mail', { connection });
const e = new Queue('mail', { connection: { ...getRedisOptions(), maxRetriesPerRequest: null } });
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `factoryFunctions` | `string[]` | none (required) | Names of the functions that build the connection options, matched on the callee name. The rule does nothing until this is set. |
| `clientClasses` | `string[]` | `['Redis', 'IORedis']` | Class names whose `new` expressions are checked. Replaces the default list. |
| `allowIn` | `string[]` | test files | Globs of files where inline options are allowed. Replaces the default `**/*.{spec,test}.{ts,tsx,mts,cts,js,jsx,mjs,cjs}` and `**/__tests__/**`. |

Add the module that defines the factory to `allowIn`, or its own `new Redis(...)` is reported:

```js
'noctcore-nestjs/redis-client-from-factory': ['error', { factoryFunctions: ['getRedisOptions'], allowIn: ['src/redis/**'] }]
```

With `clientClasses` set, only those classes are checked:

```ts bad options={"factoryFunctions":["getRedisOptions"],"clientClasses":["Cache"]}
const cache = new Cache({ host: 'localhost' });
```

```ts good options={"factoryFunctions":["getRedisOptions"],"clientClasses":["Cache"]}
const redis = new Redis({ host: 'localhost' });
const cache = new Cache(getRedisOptions());
```

## When not to use it

When your project has no single place that builds its Redis options, or builds them through a
dependency injection token that no call names. The rule needs a function name to look for, so it
cannot tell a configured connection from an inline one there.

## Related

- [`worker-must-implement-close`](/eslint-plugins/rules/nestjs/worker-must-implement-close/)
  polices the workers whose connections this rule checks.
- [`queue-options-must-set-retention`](/eslint-plugins/rules/nestjs/queue-options-must-set-retention/)
  reads the options of the same `new Queue(...)`.
