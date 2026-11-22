# `noctcore-three/renderer-dpr-cap`

> A renderer's pixel ratio is capped, never taken straight from `devicePixelRatio`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

The cost of a fragment shader grows with the square of the pixel ratio. A phone at
`devicePixelRatio` 3 shades nine pixels for every CSS pixel, 2.25 times the work of a ratio of 2,
for a difference few people can see. three.js runs at whatever ratio it is given, so the raw
ratio puts the heaviest load on the devices with the least GPU per pixel:

```ts bad
import { WebGLRenderer } from 'three';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
```

```ts good
import { WebGLRenderer } from 'three';

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
```

## What it flags

- `setPixelRatio(devicePixelRatio)` on any receiver (`window.`, `globalThis.` and `self.` too), so
  renderers and post-processing composers are both covered.
- `Math.max(devicePixelRatio, n)`, which raises the floor and caps nothing.
- `setPixelRatio(n)` and `Math.min(devicePixelRatio, n)` with a literal `n` above `maxDpr`.
- The same values in React Three Fiber's `<Canvas dpr={...}>` (the `Canvas` imported from
  `@react-three/fiber`, under any local name), including the max of a `[min, max]` pair.

```tsx bad filename=src/App.tsx reports=2
import { Canvas } from '@react-three/fiber';

export const Hero = () => <Canvas dpr={window.devicePixelRatio} />;
export const Product = () => <Canvas dpr={[1, 3]} />;
```

```tsx good filename=src/App.tsx
import { Canvas } from '@react-three/fiber';

export const Hero = () => <Canvas dpr={[1, 2]} />;
export const Product = () => <Canvas dpr={[1, 2]} />;
```

## What it does not flag

- Files that import neither `three` (or a `three/*` subpath), `three-stdlib`, an
  `@react-three/*` package nor one of `extraModules`: the rule only runs in three.js code, so
  another engine's API with the same names (a Phaser or Babylon camera) is never read as three.js.
  Only static `import` declarations count: a file that loads three.js only through `import()` or
  `require()` is skipped, which can hide a report but never adds one.
- A `<Canvas>` with no `dpr` prop: R3F already defaults to `[1, 2]`.
- A value the rule cannot read: a variable, a store value, a function call such as R3F's
  `PerformanceMonitor` result. Those are runtime decisions.
- A `dpr` prop on any component that is not R3F's `Canvas`, and a plain `setPixelRatio()` function
  that is not a method.

```tsx good filename=src/App.tsx
import { Canvas } from '@react-three/fiber';

export const Hero = () => <Canvas />;
export const Product = ({ dpr }: { dpr: number }) => <Canvas dpr={dpr} />;
```

Capping by total pixel count (a 4K monitor at ratio 2 is still 33 million pixels) is better than
capping the ratio, but it needs the canvas size at runtime, which a static rule does not have.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxDpr` | `number` | `2` | The highest pixel ratio a renderer may run at. |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |
| `extraModules` | `string[]` | `[]` | More module specifiers that mark a file as three.js code (a project module that re-exports three.js, such as `@acme/engine`); subpaths match too, and their imports count as three.js classes and R3F hooks. |

```js
'noctcore-three/renderer-dpr-cap': ['error', { maxDpr: 1.5, allowIn: ['**/tools/screenshot/**'] }]
```

## When not to use it

An offline renderer or a screenshot tool that renders at full device resolution on purpose: put
it in `allowIn` instead of turning the rule off.
