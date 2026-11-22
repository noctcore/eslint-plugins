# `noctcore-three/capability-probe-performance-caveat`

> A WebGL support check asks for `failIfMajorPerformanceCaveat`, so it says no on software renderers.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A WebGL support check asks for a context and tests the result. A plain `getContext('webgl2')`
also succeeds on a software renderer (SwiftShader, llvmpipe, a GPU on the browser's blocklist), so
the check says yes and the scene runs at a few frames per second, where the static fallback the
check was written for would have been the better page. The `failIfMajorPerformanceCaveat: true`
context attribute makes the context request fail in exactly that case.

```ts bad
export function canRenderScene() {
  const canvas = document.createElement('canvas');
  return !!canvas.getContext('webgl2');
}
```

```ts good
export function canRenderScene() {
  const canvas = document.createElement('canvas');
  return !!canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true });
}
```

## What it flags

`getContext('webgl')`, `getContext('webgl2')` or `getContext('experimental-webgl')` with no
options object, or one without `failIfMajorPerformanceCaveat`, whose result is only tested:

- negated (`!ctx`, `!!ctx`), compared with `null` or `undefined`, passed to `Boolean()`, or used as
  the condition of an `if`, a loop or a `? :`, including through `&&` and `||`;
- held in a `const` that is only used those ways, or as the receiver of `getExtension()`,
  `getParameter()` or `getSupportedExtensions()`.

```ts bad reports=2
export function probe(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}
```

## What it does not flag

- A context that is used to render: passed to a renderer, returned, stored, drawn with.
- An options argument the rule cannot read (a variable, a spread), and an explicit
  `failIfMajorPerformanceCaveat: false`, which is a decision.
- `getContext('2d')` and `getContext('webgpu')`.

```ts good
export function probe(canvas: HTMLCanvasElement) {
  const options = { failIfMajorPerformanceCaveat: true };
  const gl = canvas.getContext('webgl2', options) || canvas.getContext('webgl', options);
  if (!gl) return false;
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}
```

Helpers that probe for you, such as `WebGL.isWebGL2Available()` from `three/addons`, are not
checked. They make a plain probe, so a check built on them has the same problem.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |

```js
'noctcore-three/capability-probe-performance-caveat': ['error', { allowIn: ['**/diagnostics/**'] }]
```

## When not to use it

An app whose whole point is the 3D scene, with no fallback page worth showing, may prefer to run
slowly on software rendering than not at all. That is why the rule is opt-in.
