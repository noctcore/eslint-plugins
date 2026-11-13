# `noctcore-security/auth-cookie-flags`

> An auth cookie (`session`, `sid`, `auth_token`, `authToken` by default) must be written with `httpOnly: true`, `secure` and a valid `sameSite`.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A session or auth token in a cookie is the credential itself. Without `httpOnly`, any script on the
page can read it, so one XSS bug hands the session to an attacker. Without `secure`, the browser
sends it over plain HTTP, where anyone on the network can copy it. Without `sameSite`, the browser
attaches it to requests started by other sites, which is the opening a CSRF attack needs. Cookie
libraries leave all three off unless you ask, so a forgotten options object ships a weak cookie
without a warning.

```ts bad
import type { Response } from 'express';

export function login(res: Response, token: string) {
  res.cookie('session', token);
}
```

```ts good
import type { Response } from 'express';

export function login(res: Response, token: string) {
  res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax' });
}
```

## What it flags

A write of a cookie whose name is an auth cookie name, in one of five call shapes:

| Shape                                | Typical source  | Name read from  | Options read from |
| ------------------------------------ | --------------- | --------------- | ----------------- |
| `cookie.<name>.set(opts)`            | cookie stores   | the member name | first argument    |
| `set(name, value, opts)`             | a bare `set`    | first argument  | third argument    |
| `<any>.setCookie(name, value, opts)` | Fastify `reply` | first argument  | third argument    |
| `<any>.cookie(name, value, opts)`    | Express `res`   | first argument  | third argument    |
| `cookies().set(name, value, opts)`   | Next.js         | first argument  | third argument    |

`cookies().set` is read awaited too, as `(await cookies()).set(...)`. The name must be a static
string (a string literal, a template literal with no expressions, or `cookie['auth_token']` in the
first shape). Each required flag is checked on its own, and each one that is missing or wrong draws
its own report:

| Flag       | Passes                                                         | Reported                                         |
| ---------- | -------------------------------------------------------------- | ------------------------------------------------ |
| `httpOnly` | literal `true` only                                            | absent, `undefined`, `false`, any non-literal    |
| `secure`   | literal `true`, or any non-literal such as `isProd`            | absent, `undefined`, `false` or another literal  |
| `sameSite` | `'lax'`, `'strict'` or `'none'` in any case, or a non-literal  | absent, `undefined`, another string, a boolean   |

`sameSite: 'none'` also needs literal `secure: true`, because browsers reject a `SameSite=None`
cookie that is not `Secure`. A write with no options argument reports every required flag, and an
options argument that is not an object literal (a variable, a call) counts only when it is named in
`trustedConfigNames`.

```ts bad
import type { Response } from 'express';

export function login(res: Response, token: string) {
  res.cookie('auth_token', token, { httpOnly: false, secure: true, sameSite: 'lax' });
}
```

```ts bad reports=1
import { cookies } from 'next/headers';

export async function signIn(token: string) {
  (await cookies()).set('session', token, { secure: true, sameSite: 'lax' });
}
```

```ts bad reports=3
import type { FastifyReply } from 'fastify';

export function login(reply: FastifyReply, token: string) {
  reply.setCookie('session', token);
}
```

```ts bad reports=3
declare const cookie: Record<string, { set(options: object): void }>;

export function login(token: string) {
  cookie.session.set({ value: token });
}
```

```ts bad reports=1
import type { Response } from 'express';

declare const isProd: boolean;

export function login(res: Response, token: string) {
  res.cookie('session', token, { httpOnly: true, secure: isProd, sameSite: 'none' });
}
```

## What it does not flag

A cookie whose name is not an auth cookie name, or whose name is not a static string:

```ts good
import type { Response } from 'express';

export function remember(res: Response, theme: string, name: string, value: string) {
  res.cookie('theme', theme);
  res.cookie(name, value);
}
```

A `set` on any receiver other than `cookies()` or `cookie.<name>`, such as a `Map`:

```ts good
const sessions = new Map<string, string>();

export function track(id: string) {
  sessions.set('session', id);
}
```

A non-literal `secure` or `sameSite`, which is accepted on trust because its value is only known at
runtime:

```ts good
import type { Response } from 'express';

declare const isProd: boolean;
declare const policy: 'lax' | 'strict';

export function login(res: Response, token: string) {
  res.cookie('session', token, { httpOnly: true, secure: isProd, sameSite: policy });
}
```

A spread of a config named in `trustedConfigNames`, shown under [Options](#options).

The rule does not follow an aliased store (`const store = cookies(); store.set(...)`), and does not
read the single-object form `cookies().set({ name, value, ... })`, a bare `setCookie(...)` call such
as Hono's `setCookie(c, name, value, opts)`, or a spread in the argument list. Those are left to
review.

## Options

| Option               | Type                                       | Default                                         | Description                                                                                                                                                                                             |
| -------------------- | ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `require`            | `('httpOnly' \| 'secure' \| 'sameSite')[]` | `['httpOnly', 'secure', 'sameSite']`            | The flags an auth cookie must set. A configured list replaces the default.                                                                                                                              |
| `authCookieNames`    | `string[]`                                 | `['auth_token', 'session', 'sid', 'authToken']` | Cookie names checked, by exact, case-sensitive match. A configured list replaces the default.                                                                                                           |
| `authCookiePattern`  | `string`                                   | unset                                           | A regular-expression source, compiled with the `u` flag and case-sensitive. Names it matches are checked in addition to `authCookieNames`. It must be a valid regular expression.                       |
| `trustedConfigNames` | `string[]`                                 | `[]`                                            | Shared cookie configs. A spread of one, or a whole options argument named here, counts as setting every flag the object does not write itself. An entry ending in `()` matches any call to that callee. |

```js
// eslint.config.js
export default [
  {
    rules: {
      'noctcore-security/auth-cookie-flags': [
        'error',
        { authCookiePattern: '^refresh_', trustedConfigNames: ['AUTH_COOKIE_OPTIONS', 'cookieOptions()'] },
      ],
    },
  },
];
```

With `trustedConfigNames`, a spread of the named config sets every flag the object does not write.
A flag the object writes itself is still checked, so `httpOnly: false` next to the spread is
reported:

```ts bad options={"trustedConfigNames":["AUTH_COOKIE_OPTIONS"]}
import type { Response } from 'express';

declare const AUTH_COOKIE_OPTIONS: object;

export function login(res: Response, token: string) {
  res.cookie('session', token, { ...AUTH_COOKIE_OPTIONS, httpOnly: false });
}
```

```ts good options={"trustedConfigNames":["AUTH_COOKIE_OPTIONS"]}
import type { Response } from 'express';

declare const AUTH_COOKIE_OPTIONS: object;

export function login(res: Response, token: string) {
  res.cookie('session', token, { ...AUTH_COOKIE_OPTIONS, maxAge: 3600 });
}
```

A configured `authCookieNames` replaces the default list, so `jwt` is checked and `session` is not:

```ts bad options={"authCookieNames":["jwt"]}
import type { Response } from 'express';

export function login(res: Response, token: string) {
  res.cookie('jwt', token, { httpOnly: true, secure: true });
}
```

```ts good options={"authCookieNames":["jwt"]}
import type { Response } from 'express';

export function login(res: Response, token: string, id: string) {
  res.cookie('jwt', token, { httpOnly: true, secure: true, sameSite: 'strict' });
  res.cookie('session', id);
}
```

`authCookiePattern` adds names to the checked set:

```ts bad options={"authCookiePattern":"^refresh_"}
import type { Response } from 'express';

export function rotate(res: Response, token: string) {
  res.cookie('refresh_token', token, { secure: true, sameSite: 'strict' });
}
```

```ts good options={"authCookiePattern":"^refresh_"}
import type { Response } from 'express';

export function rotate(res: Response, token: string) {
  res.cookie('refresh_token', token, { httpOnly: true, secure: true, sameSite: 'strict' });
}
```

`require` narrows the flags checked, here to `httpOnly` alone:

```ts bad options={"require":["httpOnly"]}
import type { Response } from 'express';

export function login(res: Response, token: string) {
  res.cookie('session', token, {});
}
```

```ts good options={"require":["httpOnly"]}
import type { Response } from 'express';

export function login(res: Response, token: string) {
  res.cookie('session', token, { httpOnly: true });
}
```

## When not to use it

The rule is opt-in because the package is at 1.x, where a rule entering `recommended` is a breaking
change, and because it picks auth cookies by name: a cookie called `session` that holds no
credential is reported too. Narrow `authCookieNames` to the cookies that carry a credential in your
project, or scope the rule with `files` / `ignores`.

Leave it off where cookie flags are set in one place the rule cannot see, such as a framework that
applies secure defaults to every cookie, unless you name that config in `trustedConfigNames`.
