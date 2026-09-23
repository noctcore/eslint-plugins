import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireSchemaParseAtBoundaryRule } from '../../src/rules/require-schema-parse-at-boundary';

const FILE = 'src/api.ts';

ruleTester.run('require-schema-parse-at-boundary', requireSchemaParseAtBoundaryRule, {
  valid: [
    // Parsed at runtime — the intended shape.
    {
      code: `const user = UserSchema.parse(JSON.parse(raw));`,
      filename: FILE,
    },
    {
      code: `async function f(res) { return UserSchema.parse(await res.json()); }`,
      filename: FILE,
    },
    // Safe/neutral cast targets are never flagged.
    {
      code: `const data = JSON.parse(raw) as unknown;`,
      filename: FILE,
    },
    {
      code: `const data = JSON.parse(raw) as any;`,
      filename: FILE,
    },
    {
      code: `const tuple = JSON.parse(raw) as const;`,
      filename: FILE,
    },
    // Cast on a non-boundary value is out of scope for the syntactic slice.
    {
      code: `const user = value as User;`,
      filename: FILE,
    },
    // Casting after the parse: the schema already checked the shape.
    {
      code: `const user = UserSchema.parse(JSON.parse(raw)) as User;`,
      filename: FILE,
    },
    {
      code: `async function f(res) { const raw = await res.json(); const user = UserSchema.parse(raw); return user as User; }`,
      filename: FILE,
    },
    // `satisfies` is a check against the value's own type, not an assertion.
    {
      code: `const config = JSON.parse(raw) satisfies Config;`,
      filename: FILE,
    },
    // Union of neutral forms is still neutral.
    {
      code: `const v = localStorage.getItem('theme') as string | null;`,
      filename: FILE,
    },
    // A const bound to a non-boundary value.
    {
      code: `const raw = buildDefaults(); const cfg = raw as Config;`,
      filename: FILE,
    },
    // Binding read by a guard / validator before the cast: benefit of the doubt.
    {
      code: `async function f(res) { const raw = await res.json(); assertUser(raw); return raw as User; }`,
      filename: FILE,
    },
    {
      code: `async function f(res) { const raw = await res.json(); if (!isUser(raw)) throw new Error('bad'); return raw as User; }`,
      filename: FILE,
    },
    {
      code: `const raw = JSON.parse(text); if (!('id' in raw)) throw new Error('bad'); const user = raw as User;`,
      filename: FILE,
    },
    // `let` bindings are not followed: they can be reassigned.
    {
      code: `async function f(res) { let raw = await res.json(); raw = normalize(raw); return raw as User; }`,
      filename: FILE,
    },
    {
      code: `async function f(res) { let raw = await res.json(); return raw as User; }`,
      filename: FILE,
    },
    // Destructured const bindings are not followed.
    {
      code: `async function f(res) { const { user } = await res.json(); return user as User; }`,
      filename: FILE,
    },
    // Read from a nested function: the binding escaped, so it is not followed.
    {
      code: `async function f(res) { const raw = await res.json(); const check = () => validate(raw); check(); return raw as User; }`,
      filename: FILE,
    },
    // Cast in a different function from the declaration.
    {
      code: `async function f(res) { const raw = await res.json(); return () => raw as User; }`,
      filename: FILE,
    },
    // Storage look-alikes: another object's getItem, and a Map.get.
    {
      code: `const v = cache.getItem('theme') as Theme;`,
      filename: FILE,
    },
    {
      code: `const v = settings.get('theme') as Theme;`,
      filename: FILE,
    },
    // `.get` on something that is not a URLSearchParams.
    {
      code: `const params = new Map(); const sort = params.get('sort') as Sort;`,
      filename: FILE,
    },
    {
      code: `const sort = headers.get('x-sort') as Sort;`,
      filename: FILE,
    },
    // `.data` outside a message listener, and in other event listeners.
    {
      code: `function f(event) { return event.data as Payload; }`,
      filename: FILE,
    },
    {
      code: `input.addEventListener('input', (event) => { const v = event.data as Payload; });`,
      filename: FILE,
    },
    {
      code: `const v = response.data as Payload;`,
      filename: FILE,
    },
    // A message listener that parses before casting.
    {
      code: `window.addEventListener('message', (event) => { const msg = MessageSchema.parse(event.data); handle(msg as Message); });`,
      filename: FILE,
    },
    // A cast of the event itself is not a payload claim.
    {
      code: `worker.addEventListener('message', (event) => { const e = event as MessageEvent; });`,
      filename: FILE,
    },
    // `.input` without a tool_use guard, or guarded by another block type.
    {
      code: `const args = block.input as WeatherArgs;`,
      filename: FILE,
    },
    {
      code: `if (block.type === 'text') { const args = block.input as WeatherArgs; }`,
      filename: FILE,
    },
    {
      code: `if (other.type === 'tool_use') { const args = block.input as WeatherArgs; }`,
      filename: FILE,
    },
    {
      code: `if (block.type === 'tool_use') { handle(); } else { const args = block.input as WeatherArgs; }`,
      filename: FILE,
    },
    {
      code: `if (block.type === 'tool_use') { const args = WeatherArgsSchema.parse(block.input); }`,
      filename: FILE,
    },
    // `boundaries` only matches the configured callee.
    {
      code: `const body = readConfig(event) as Body;`,
      filename: FILE,
      options: [{ boundaries: ['readBody'] }],
    },
    {
      code: `const body = readBody(event) as Body;`,
      filename: FILE,
    },
  ],
  invalid: [
    // JSON.parse asserted to a named shape.
    {
      code: `const user = JSON.parse(raw) as User;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // JSON.parse asserted to an array shape.
    {
      code: `const users = JSON.parse(raw) as User[];`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Awaited response body asserted instead of parsed.
    {
      code: `async function f(res) { const user = (await res.json()) as User; return user; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // A union containing a shape claim is a shape claim.
    {
      code: `const user = JSON.parse(raw) as User | null;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Same-function const bindings are followed.
    {
      code: `async function f(res) { const raw = await res.json(); return raw as User; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const raw = JSON.parse(text); const user = raw as User;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Through a chain of consts.
    {
      code: `async function f(res) { const body = await res.json(); const raw = body; return raw as User; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Reads after the cast do not excuse it.
    {
      code: `async function f(res) { const raw = await res.json(); const user = raw as User; log(raw); return user; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Web storage fed to JSON.parse, directly and through a binding.
    {
      code: `const prefs = JSON.parse(localStorage.getItem('prefs') ?? '{}') as Prefs;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const stored = sessionStorage.getItem('cart'); const cart = JSON.parse(stored!) as Cart;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Web storage cast directly to a string-literal union.
    {
      code: `const theme = window.localStorage.getItem('theme') as Theme;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // URL search params.
    {
      code: `const sort = new URLSearchParams(location.search).get('sort') as Sort;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const sort = request.nextUrl.searchParams.get('sort') as Sort;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const sort = searchParams.get('sort') as Sort;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const params = new URLSearchParams(location.search); const tags = params.getAll('tag') as Tag[];`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const url = new URL(href); const sort = url.searchParams.get('sort')! as Sort;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Message-event payloads.
    {
      code: `window.addEventListener('message', (event) => { handle(event.data as Message); });`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `socket.addEventListener('message', function (e) { const msg = e.data; route(msg as Message); });`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `worker.onmessage = ({ data }) => { handle(data as Message); };`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `onmessage = ({ data: payload }) => { run(payload as Job); };`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // OpenAI tool-call arguments fed to JSON.parse.
    {
      code: `for (const call of message.tool_calls) { const args = JSON.parse(call.function.arguments) as WeatherArgs; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const raw = toolCall.function.arguments; const args = JSON.parse(raw); run(args as SearchArgs);`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Anthropic tool_use block input.
    {
      code: `for (const block of response.content) { if (block.type === 'tool_use') { run(block.input as WeatherArgs); } }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `for (const block of response.content) { if (block.type === 'tool_use' && block.name === 'weather') { const input = block.input; run(input as WeatherArgs); } }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const args = block.type === 'tool_use' ? (block.input as WeatherArgs) : null;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `switch (block.type) { case 'tool_use': run(block.input as WeatherArgs); break; }`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const toolUse = response.content.find((b) => b.type === 'tool_use'); const args = toolUse?.input as WeatherArgs;`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `const all = response.content.filter((b) => b.type === 'tool_use').map((block) => block.input as ToolArgs);`,
      filename: FILE,
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    // Configured boundaries.
    {
      code: `const body = (await readBody(event)) as Body;`,
      filename: FILE,
      options: [{ boundaries: ['readBody'] }],
      errors: [{ messageId: 'castedBoundaryData' }],
    },
    {
      code: `async function f() { const reply = await ipcRenderer.invoke('get-user'); return reply as User; }`,
      filename: FILE,
      options: [{ boundaries: ['ipcRenderer.invoke'] }],
      errors: [{ messageId: 'castedBoundaryData' }],
    },
  ],
});
