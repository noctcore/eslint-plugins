# `noctcore-three/shadow-map-size-cap`

> Shadow maps stay within a size budget.

<!-- begin generated rule header -->
🔘 Opt-in: not in `recommended` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Every shadow-casting light renders its casters into a depth texture of `shadow.mapSize` each time
it updates. Memory and fill cost grow with the square of the size: a 4096 map is four times a 2048
one, and a point light renders six faces. On integrated and mobile GPUs that is often the largest
single cost in a scene.

```ts bad
import { DirectionalLight } from 'three';

const sun = new DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
```

```ts good
import { DirectionalLight } from 'three';

const sun = new DirectionalLight(0xffffff, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
```

## What it flags

A literal number above `maxMapSize` in:

- `light.shadow.mapSize.set(width, height)` and `.setScalar(size)`;
- `light.shadow.mapSize.width = size` (also `height`, `x`, `y`);
- React Three Fiber props on any element: `shadow-mapSize={[width, height]}`,
  `shadow-mapSize={size}`, `shadow-mapSize-width={size}` and `shadow-mapSize-height={size}`.

```tsx bad filename=src/Lights.tsx reports=2
import { Canvas } from '@react-three/fiber';

export const Scene = () => <Canvas shadows><Sun /></Canvas>;
export const Sun = () => <directionalLight castShadow shadow-mapSize={[4096, 4096]} />;
```

```tsx good filename=src/Lights.tsx
import { Canvas } from '@react-three/fiber';

export const Scene = () => <Canvas shadows><Sun /></Canvas>;
export const Sun = () => <directionalLight castShadow shadow-mapSize={[2048, 2048]} />;
```

## What it does not flag

- Files that import neither `three` (or a `three/*` subpath), `three-stdlib`, an
  `@react-three/*` package nor one of `extraModules`: the rule only runs in three.js code, so
  another engine's API with the same names (a Phaser or Babylon camera) is never read as three.js.
  Only static `import` declarations count: a file that loads three.js only through `import()` or
  `require()` is skipped, which can hide a report but never adds one.
- Sizes the rule cannot read: a variable, a quality setting chosen at runtime.
- `mapSize` that is not under `.shadow`, and other render target sizes.

```ts good
import { DirectionalLight } from 'three';

const sun = new DirectionalLight(0xffffff, 2);
sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `maxMapSize` | `integer` | `2048` | The largest shadow map width or height allowed. |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |
| `extraModules` | `string[]` | `[]` | More module specifiers that mark a file as three.js code (a project module that re-exports three.js, such as `@acme/engine`); subpaths match too, and their imports count as three.js classes and R3F hooks. |

```js
'noctcore-three/shadow-map-size-cap': ['error', { maxMapSize: 1024 }]
```

## When not to use it

A desktop-only app with one shadow-casting light may want 4096; raise `maxMapSize` rather than
turning the rule off, so a second large map still needs a decision. The rule is opt-in because the
right budget depends on the devices a project targets.
