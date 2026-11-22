# `noctcore-three/no-allocation-in-frame-loop`

> No three.js math objects or GPU resources constructed inside a frame loop.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A frame loop runs 60 to 120 times a second. A `new Vector3()` in it is thousands of short-lived
objects a minute, and the garbage collector pays for them in pauses that show up as dropped frames.
A geometry, material or texture built there is worse: each one is uploaded to the GPU and never
disposed. Create the object once and reuse it with `.set()` and `.copy()`:

```tsx bad filename=src/Float.tsx
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export function Float({ mesh }: { mesh: { current: THREE.Mesh } }) {
  useFrame(() => {
    mesh.current.position.lerp(new THREE.Vector3(0, 1, 0), 0.1);
  });
  return null;
}
```

```tsx good filename=src/Float.tsx
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const target = new THREE.Vector3(0, 1, 0);

export function Float({ mesh }: { mesh: { current: THREE.Mesh } }) {
  useFrame(() => {
    mesh.current.position.lerp(target, 0.1);
  });
  return null;
}
```

## What it flags

`new X()` inside a frame loop, where `X` is imported from `three` (named, or through
`import * as THREE`) and is either:

- a math class: `Vector2`, `Vector3`, `Vector4`, `Matrix3`, `Matrix4`, `Quaternion`, `Euler`,
  `Color`, `Box2`, `Box3`, `Sphere`, `Ray`, `Plane`, `Line3`, `Triangle`, `Spherical`,
  `Cylindrical`, `Frustum`, `Raycaster`;
- a GPU resource: any `*Geometry`, `*Material`, `*Texture` or `*RenderTarget` class.

A frame loop is the callback of R3F's `useFrame` (imported from `@react-three/fiber`), the callback
of `renderer.setAnimationLoop()`, or a function that schedules itself with
`requestAnimationFrame(name)` (also `requestAnimationFrame(this.name)` in a class). Callbacks are
matched inline or by reference (`setAnimationLoop(tick)` resolves `tick` through scope), and inline callbacks inside the loop (`items.forEach(...)`) count too.

```ts bad filename=src/loop.ts
import { Vector3 } from 'three';

function animate() {
  requestAnimationFrame(animate);
  mesh.position.add(new Vector3(0, 0.01, 0));
  renderer.render(scene, camera);
}
animate();
```

```ts good filename=src/loop.ts
import { Vector3 } from 'three';

const step = new Vector3(0, 0.01, 0);

function animate() {
  requestAnimationFrame(animate);
  mesh.position.add(step);
  renderer.render(scene, camera);
}
animate();
```

## What it does not flag

- Files that import neither `three` (or a `three/*` subpath), `three-stdlib`, an
  `@react-three/*` package nor one of `extraModules`: the rule only runs in three.js code, so
  another engine's API with the same names (a Phaser or Babylon camera) is never read as three.js.
- Lazy initialisation that runs once: `ref.current ??= new Vector3()`, `cache ?? new Vector3()`,
  and `ref.current = new Vector3()` under an `if`, or after an early return
  (`if (ref.current) return;`), that tests the same target.
- Classes that are not imported from `three` (a local `Vector3` class), and three.js classes that
  are neither math nor GPU resources (`Group`, `Object3D`).
- A one-shot `requestAnimationFrame(() => ...)`, and a helper function declared inside the loop.
- `.clone()` calls: without type information the rule cannot tell a `Vector3` from anything else
  with a `clone()` method.

```tsx good filename=src/Float.tsx
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export function Float({ mesh, target }: { mesh: { current: THREE.Mesh }; target: { current?: THREE.Vector3 } }) {
  useFrame(() => {
    target.current ??= new THREE.Vector3(0, 1, 0);
    mesh.current.position.lerp(target.current, 0.1);
  });
  return null;
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |
| `extraModules` | `string[]` | `[]` | More module specifiers that mark a file as three.js code (a project module that re-exports three.js, such as `@acme/engine`); subpaths match too. |

```js
'noctcore-three/no-allocation-in-frame-loop': ['error', { allowIn: ['**/demos/**'] }]
```

## When not to use it

Code whose loop runs rarely (a `frameloop="demand"` canvas that renders on interaction only) gains
little from hoisting, though it costs nothing either.

## Related

- [`no-react-state-in-frame-loop`](../no-react-state-in-frame-loop/): the other per-frame cost, a
  React render on every frame.
- [`no-resource-creation-in-render`](../no-resource-creation-in-render/): the same resources built in
  a component body.
