# `noctcore-security/presigned-post-requires-policy`

> A `createPresignedPost` call must pin the upload size and Content-Type in literal `Conditions`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A presigned POST from `@aws-sdk/s3-presigned-post` is a write capability handed to the browser. When
the upload arrives, S3 checks only the policy signed into it; none of your server code runs between
the client and the bucket. Without conditions, the client decides how big the file is and what
Content-Type it is stored with, `text/html` included, which turns an avatar bucket into a host for
arbitrary pages or a way to run up the storage bill:

```ts bad
// any size, any Content-Type
const post = await createPresignedPost(s3, { Bucket: bucket, Key: key, Expires: 300 });
```

Pin both in the policy:

```ts good
const post = await createPresignedPost(s3, {
  Bucket: bucket,
  Key: key,
  Conditions: [
    ['content-length-range', 1, MAX_FILE_SIZE],
    ['eq', '$Content-Type', contentType],
  ],
  Fields: { 'Content-Type': contentType },
  Expires: 300,
});
```

## What it flags

Every call to `createPresignedPost` (bare or as a member, `presigner.createPresignedPost`) whose
second argument is not an object literal with a literal `Conditions` array, or whose `Conditions`
lack either tuple:

- `['content-length-range', min, max]`, with all three elements;
- `['eq', '$Content-Type', type]`. A `starts-with` condition on `$Content-Type` does not count,
  because `['starts-with', '$Content-Type', '']` pins nothing.

```ts bad reports=2
// an empty policy pins neither
await createPresignedPost(s3, { Bucket: bucket, Key: key, Conditions: [] });
```

A policy built somewhere else and passed by name is reported rather than followed, so the policy
stays reviewable where the capability is minted:

```ts bad
await createPresignedPost(s3, uploadOptions);
```

Tuples hidden behind a spread (`Conditions: [...policy]`) are not visible at the call and count as
missing.

## What it does not flag

Extra conditions, in any order, and other presigners such as `getSignedUrl` for a single `PUT`
(whose signature already covers the Content-Type you sign):

```ts good
await createPresignedPost(s3, {
  Bucket: bucket,
  Key: key,
  Conditions: [
    ['starts-with', '$key', 'avatars/'],
    ['eq', '$Content-Type', contentType],
    ['content-length-range', 1, 10_000_000],
  ],
});
```

It does not check that the limits are sensible, only that they are stated.

## When not to use it

If your uploads go through a server that checks size and type itself, and you never hand a
presigned POST to a client, the rule never fires and costs nothing. Turn it off only if you build
the policy in a shared helper on purpose and review it there.
