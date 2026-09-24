# `noctcore-contracts/require-schema-parse-at-boundary`

> Parse external boundary data at runtime — don't assert its shape with `as T`.

<!-- begin generated rule header -->
🔘 Opt-in: `off` in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

External data — a fetch body, a `JSON.parse` result, a message-event payload — has whatever shape the
sender actually sent, which TypeScript never sees. Asserting it with `as User` is a compile-time
promise the runtime never checks: a field the server dropped is now `undefined` masquerading as a
`string`, and the corruption surfaces far from the boundary. Parsing with a runtime schema
(zod/valibot) validates the shape at the edge and fails loudly there:

```ts good
const user = UserSchema.parse(await res.json()); // validated
```

## What it flags

This is a **conservative syntactic slice** of a concept that is fully general only with type
information. It flags a cast whose target is a **shape claim** (a named type, an array, or a union
containing one: `as User`, `as User[]`, `as User | null`) applied to a boundary read:

```ts bad reports=3
const user = JSON.parse(raw) as User;
const users = JSON.parse(raw) as User[];
const fetched = (await res.json()) as User;
```

```ts good
const user = UserSchema.parse(JSON.parse(raw));
const users = UserSchema.array().parse(JSON.parse(raw));
const fetched = UserSchema.parse(await res.json());
```

The boundary reads it knows:

| Source | Example |
| --- | --- |
| `JSON.parse(...)` | covers web storage and OpenAI `call.function.arguments` fed to it |
| `await <expr>.json()` | a fetch `Response` body |
| `localStorage.getItem` / `sessionStorage.getItem` | also through `window.` / `globalThis.` |
| `URLSearchParams` `.get` / `.getAll` | `new URLSearchParams(...)`, `<x>.searchParams`, a `searchParams` binding, or a `const` bound to one of those |
| `event.data` in a `message` listener | `x.addEventListener('message', fn)`, `x.onmessage = fn`, `onmessage = fn`, including a `{ data }` parameter |
| Anthropic `tool_use` `.input` | `block.input` inside `if (block.type === 'tool_use')`, a `?:` / `&&` guard, `case 'tool_use':`, a `.find((b) => b.type === 'tool_use')` result, or a `.filter(...)` of that shape followed by `.map` / `.flatMap` / `.forEach` |
| `boundaries` option | any callee you list |

```ts bad reports=5
const prefs = JSON.parse(localStorage.getItem('prefs') ?? '{}') as Prefs;
const sort = new URLSearchParams(location.search).get('sort') as Sort;
window.addEventListener('message', (event) => handle(event.data as Message));
const args = JSON.parse(call.function.arguments) as WeatherArgs;
if (block.type === 'tool_use') run(block.input as WeatherArgs);
```

```ts good
const prefs = PrefsSchema.parse(JSON.parse(localStorage.getItem('prefs') ?? '{}'));
const sort = SortSchema.parse(new URLSearchParams(location.search).get('sort'));
window.addEventListener('message', (event) => handle(MessageSchema.parse(event.data)));
const args = WeatherArgsSchema.parse(JSON.parse(call.function.arguments));
if (block.type === 'tool_use') run(WeatherArgsSchema.parse(block.input));
```

### Through a `const`

A boundary value stored in a `const` and cast later in the same function is flagged too:

```ts bad
async function loadUser(res: Response) {
  const raw = await res.json();
  return raw as User;
}
```

```ts good
async function loadUser(res: Response) {
  const raw = await res.json();
  return UserSchema.parse(raw);
}
```

The binding is followed only when nothing could have checked the value first, so the rule gives the
benefit of the doubt whenever it cannot prove otherwise:

- Only a single `const name = <boundary>` is followed, never `let`, `var`, a destructuring pattern
  or a parameter. Chains of such consts (`const body = await res.json(); const raw = body;`) are
  followed.
- The cast must be in the same function as the declaration.
- Any read of the binding before the cast other than another `as` cast (a guard like
  `isUser(raw)`, an `assertUser(raw)` call, an `'id' in raw` check, passing it to a function,
  mutating a property) keeps the rule silent, as does any read from a nested function. Reads after
  the cast do not excuse it.

```ts prose reason="shows what the rule deliberately leaves alone, not a fix for an example above"
async function loadUser(res: Response) {
  const raw = await res.json();
  assertUser(raw); // might have validated it: not flagged
  return raw as User;
}
```

## What it does not flag

- Casts to `unknown`, `any`, `const` or a primitive keyword (`as string | null`): the safe or
  neutral forms.
- `satisfies`, which checks the value against the type instead of asserting it.
- A cast of the parse result (`UserSchema.parse(raw) as User`): the schema already checked it.
- Look-alikes that are not boundary reads: `cache.getItem(...)`, `map.get(...)`,
  `headers.get(...)`, `.data` outside a `message` listener, `.input` without a `tool_use` guard.
- A boundary value that is neither cast directly nor bound by a followed `const` (a property of
  an object, a function return value). That needs a type-aware setup.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `boundaries` | `string[]` | `[]` | Extra callees whose result is boundary data: a bare name or a dotted path. |

```js
'noctcore-contracts/require-schema-parse-at-boundary': ['error', {
  // `readBody(event) as T` and `(await readBody(event)) as T` are then flagged.
  boundaries: ['readBody', 'ipcRenderer.invoke'],
}]
```

```ts bad options={"boundaries":["readBody"]}
const body = (await readBody(event)) as Body;
```

```ts good
const body = BodySchema.parse(await readBody(event));
```

## When not to use it

If you deliberately trust certain boundaries (an internal service with a shared type package) or have
a type-aware lint pass that supersedes this heuristic, leave this rule off. It ships `off` in the
`recommended` preset for that reason — enable it where the boundary is genuinely untrusted.
