# `noctcore-rsc/no-navigation-throw-in-try`

> A `next/navigation` call that works by throwing must not sit in a `try` whose `catch` swallows it.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

In the Next.js App Router, `redirect()`, `permanentRedirect()`, `notFound()`, `forbidden()` and
`unauthorized()` do not return. Each throws a special error that Next.js catches further up and
turns into the redirect or the error page. A `catch` that handles every error catches that one
too, and the navigation silently never happens:

```ts bad filename=app/actions.ts
import { redirect } from 'next/navigation';

export async function createPost(data: FormData) {
  try {
    await db.post.create({ data: parse(data) });
    // throws, and the catch below eats it: the user never leaves the form
    redirect('/posts');
  } catch (error) {
    return { error: 'Could not save the post' };
  }
}
```

Nothing in the types or the tests says anything is wrong: the action returns `{ error }` for a
save that succeeded. Move the call out of the `try`, so only the work that can fail is guarded:

```ts good
import { redirect } from 'next/navigation';

export async function createPost(data: FormData) {
  try {
    await db.post.create({ data: parse(data) });
  } catch (error) {
    return { error: 'Could not save the post' };
  }
  redirect('/posts');
}
```

When the call has to stay inside the `try`, hand Next.js its error back with
[`unstable_rethrow`](https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow), first
in the `catch`:

```ts bad
import { notFound } from 'next/navigation';

export default async function Page({ params }: { params: { id: string } }) {
  try {
    const post = await getPost(params.id);
    if (!post) notFound();
    return render(post);
  } catch (error) {
    return renderFallback();
  }
}
```

```ts good
import { notFound, unstable_rethrow } from 'next/navigation';

export default async function Page({ params }: { params: { id: string } }) {
  try {
    const post = await getPost(params.id);
    if (!post) notFound();
    return render(post);
  } catch (error) {
    unstable_rethrow(error);
    return renderFallback();
  }
}
```

### Prior art

- react-doctor's `nextjs-no-redirect-in-try-catch`.
- [vercel/next.js#55586](https://github.com/vercel/next.js/issues/55586), the issue that led to
  `unstable_rethrow`.
- `@next/eslint-plugin-next` has no equivalent rule.

## What it flags

A call to `redirect`, `permanentRedirect`, `notFound`, `forbidden` or `unauthorized` that:

- resolves to an import from `next/navigation`, under its own name, an alias
  (`import { redirect as go }`) or a namespace (`nav.redirect()`), and
- sits, lexically and without a function in between, in the block of a `try` that has a `catch`,
  and
- that `catch` does not hand the caught error back.

A `catch` hands the error back when it calls `unstable_rethrow(error)` from `next/navigation`
with its own parameter, or throws its own parameter (`throw error`). A guarded rethrow such as
`if (isRedirectError(error)) throw error;` counts too. Wrapping it does not:
`throw new Error('failed', { cause: error })` throws an error Next.js does not recognise.

```ts bad
import { redirect } from 'next/navigation';

function guard(user: User | null) {
  try {
    if (!user) redirect('/login');
  } catch (error) {
    throw new Error('guard failed', { cause: error });
  }
}
```

A `catch` that rethrows passes the error on to the next `try` out, so an outer `catch` that
swallows it is still reported.

There is no autofix: which of moving the call and rethrowing is right depends on what the `try`
was guarding.

## What it does not flag

- A call outside any `try`, or in a `try` / `finally` with no `catch`: the error propagates.
- A call in the `catch` or the `finally` block: it throws out of the `try` statement.
- A call inside a function that is only defined in the `try`, such as a callback or an event
  handler: the `try` does not run it.
- A function called `redirect` or `notFound` that is not the `next/navigation` export: a local
  function, a parameter, or an import from `@remix-run/node` or anywhere else.

```ts good
import { redirect } from '@remix-run/node';

export async function action() {
  try {
    return redirect('/done');
  } catch {
    return null;
  }
}
```

## When not to use it

It only reports calls imported from `next/navigation`, so outside a Next.js App Router project it has
nothing to do. Inside one, a `catch` that swallows a navigation is almost always a
bug.
