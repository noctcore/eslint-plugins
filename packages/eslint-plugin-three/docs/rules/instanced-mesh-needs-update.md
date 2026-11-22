# `noctcore-three/instanced-mesh-needs-update`

> Writes through `setMatrixAt()` and `setColorAt()` are followed by the attribute's `needsUpdate`.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

`InstancedMesh.setMatrixAt()` and `setColorAt()` write into a CPU-side array. The GPU copy is
uploaded again only when the attribute's `needsUpdate` flag is set, and the three.js docs state the
flag is required after either call. Without it the instances stay where the last upload left them:
an animation that never moves, a recolor that never shows.

```ts bad filename=src/swarm.ts
import { InstancedMesh, Object3D } from 'three';

const dummy = new Object3D();

export function updateSwarm(time: number) {
  for (let i = 0; i < count; i++) {
    dummy.position.set(Math.sin(time + i), i * 0.1, 0);
    dummy.updateMatrix();
    swarm.setMatrixAt(i, dummy.matrix);
  }
}
```

```ts good filename=src/swarm.ts
import { InstancedMesh, Object3D } from 'three';

const dummy = new Object3D();

export function updateSwarm(time: number) {
  for (let i = 0; i < count; i++) {
    dummy.position.set(Math.sin(time + i), i * 0.1, 0);
    dummy.updateMatrix();
    swarm.setMatrixAt(i, dummy.matrix);
  }
  swarm.instanceMatrix.needsUpdate = true;
}
```

## What it flags

The first `setMatrixAt()` (or `setColorAt()`) call in a function with no
`<mesh>.instanceMatrix.needsUpdate = ...` (or `<mesh>.instanceColor.needsUpdate = ...`) assignment
anywhere in that function. Array callbacks (`forEach`, `map`, `reduce` and the like) and local
helpers (`const place = (i) => mesh.setMatrixAt(i, m)`) are read as part of the function around
them, so a loop over instances followed by one flag is fine. A class method reads its whole class,
so a `push()` that writes and an `end()` that sets the flag pass. Each function is reported once
per attribute.

The rule runs only in files that name `InstancedMesh` (an import, a type, a `new`, or R3F's
`<instancedMesh>` element).

```tsx bad filename=src/Grid.tsx
import { useLayoutEffect, useRef } from 'react';
import type { InstancedMesh } from 'three';

export function Grid({ layout }: { layout: Layout }) {
  const ref = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    layout.cells.forEach((cell, i) => ref.current.setColorAt(i, cell.color));
  }, [layout]);
  return <instancedMesh ref={ref} args={[undefined, undefined, layout.cells.length]} />;
}
```

```tsx good filename=src/Grid.tsx
import { useLayoutEffect, useRef } from 'react';
import type { InstancedMesh } from 'three';

export function Grid({ layout }: { layout: Layout }) {
  const ref = useRef<InstancedMesh>(null!);
  useLayoutEffect(() => {
    layout.cells.forEach((cell, i) => ref.current.setColorAt(i, cell.color));
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [layout]);
  return <instancedMesh ref={ref} args={[undefined, undefined, layout.cells.length]} />;
}
```

## What it does not flag

- A function that receives the mesh as a parameter: a helper whose caller sets the flag.
- A function that hands the mesh to another call (`scene.add(mesh)`, `markDirty(mesh)`), returns
  it, or constructs it (`const mesh = new InstancedMesh(...)`, `this.mesh = new InstancedMesh(...)`):
  a mesh still being built has not been uploaded yet, and a helper may set the flag.
- `BatchedMesh.setMatrixAt()`, which uploads by itself: receivers whose name contains `batch`
  are skipped, and files that never name `InstancedMesh` are not checked.

```ts good filename=src/swarm.ts
import { InstancedMesh, Matrix4 } from 'three';

export function buildSwarm(count: number, matrix: Matrix4) {
  const swarm = new InstancedMesh(geometry, material, count);
  for (let i = 0; i < count; i++) swarm.setMatrixAt(i, matrix);
  scene.add(swarm);
  return swarm;
}
```

Outside a class, a flag set in a different function (writes in an event handler, the flag set every
frame in the render loop) is reported. Set it where the writes are, or put the file in `allowIn`. Writes made
before the mesh first renders do not strictly need the flag; setting it costs nothing.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |

```js
'noctcore-three/instanced-mesh-needs-update': ['error', { allowIn: ['**/legacy/**'] }]
```

## When not to use it

A codebase that sets `needsUpdate` once per frame in a central render loop for every instanced
mesh it owns.
