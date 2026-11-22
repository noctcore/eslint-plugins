# `noctcore-three/require-dispose`

> Geometries, materials, textures and render targets an effect creates are disposed by that effect.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

three.js frees a geometry's buffers, a material's shader programs and a texture's image on the GPU
only when `dispose()` is called. Removing the mesh from the scene frees nothing. React Three Fiber
disposes the objects it creates from JSX when they unmount, but not the ones an effect builds by
hand, so an effect that only removes its mesh on cleanup leaks the resources on every unmount and
every re-run:

```tsx bad filename=src/Marker.tsx reports=2
import { useEffect } from 'react';
import * as THREE from 'three';

export function useMarker(scene: THREE.Scene) {
  useEffect(() => {
    const geometry = new THREE.SphereGeometry(0.2);
    const material = new THREE.MeshBasicMaterial({ color: 'orange' });
    const marker = new THREE.Mesh(geometry, material);
    scene.add(marker);
    return () => {
      scene.remove(marker);
    };
  }, [scene]);
}
```

```tsx good filename=src/Marker.tsx
import { useEffect } from 'react';
import * as THREE from 'three';

export function useMarker(scene: THREE.Scene) {
  useEffect(() => {
    const geometry = new THREE.SphereGeometry(0.2);
    const material = new THREE.MeshBasicMaterial({ color: 'orange' });
    const marker = new THREE.Mesh(geometry, material);
    scene.add(marker);
    return () => {
      scene.remove(marker);
      geometry.dispose();
      material.dispose();
    };
  }, [scene]);
}
```

## What it flags

A `const` or `let` in a `useEffect` or `useLayoutEffect` callback (`React.` prefixed too),
initialised with `new X()` where `X` is a `*Geometry`, `*Material`, `*Texture` or `*RenderTarget`
class imported from `three`, that is never `.dispose()`d in the effect, when the effect returns a
cleanup or adds the resource to the scene.

A resource is in the scene through the local object that holds it: `new Mesh(geometry, material)`
bound to a `const`, `scene.add(new Mesh(geometry))`, or `material.map = texture` on a local.
Disposing a holder itself does not count, because `material.dispose()` leaves its `map` alone;
`mesh.geometry.dispose()` does.

```tsx bad filename=src/Label.tsx
import { useEffect } from 'react';
import * as THREE from 'three';

export function useLabel(scene: THREE.Scene, canvas: HTMLCanvasElement) {
  useEffect(() => {
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial();
    material.map = texture;
    const label = new THREE.Sprite(material);
    scene.add(label);
    return () => {
      scene.remove(label);
      material.dispose();
    };
  }, [scene, canvas]);
}
```

## What it does not flag

- Files that import neither `three` (or a `three/*` subpath), `three-stdlib`, an
  `@react-three/*` package nor one of `extraModules`: the rule only runs in three.js code, so
  another engine's API with the same names (a Phaser or Babylon camera) is never read as three.js.
Anything that may be disposed somewhere the rule cannot see:

- a resource that leaves the effect: stored in a ref or an outer variable, passed to a plain
  function call (`setTexture(t)`, `track(t)`), pushed into a list or map, returned, or put in an
  object or array literal;
- a cleanup that hands the resource or its holder to any call except `remove()` / `detach()`
  (`release(mesh)`), that calls a disposal helper (any function whose name contains `dispose`
  followed by more letters, such as `disposeObject(child)`), or that walks the scene with
  `traverse()`;
- a resource that is neither added to the scene nor followed by a cleanup: it is never uploaded to
  the GPU, so there is nothing to free.

Resources from JSX, `useMemo` or `useLoader` are outside the rule: R3F disposes JSX objects itself,
and loader results are cached and shared.

```tsx good filename=src/Label.tsx
import { useEffect } from 'react';
import * as THREE from 'three';

export function useLabel(scene: THREE.Scene, canvas: HTMLCanvasElement) {
  useEffect(() => {
    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial();
    material.map = texture;
    const label = new THREE.Sprite(material);
    scene.add(label);
    return () => disposeObject(label);
  }, [scene, canvas]);
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |
| `extraModules` | `string[]` | `[]` | More module specifiers that mark a file as three.js code (a project module that re-exports three.js, such as `@acme/engine`); subpaths match too. |

```js
'noctcore-three/require-dispose': ['error', { allowIn: ['**/legacy/**'] }]
```

## When not to use it

A scene that is built once for the page's lifetime and never unmounts frees its memory when the
tab closes; the leak only matters where components mount and unmount.

## Related

- [`no-resource-creation-in-render`](../no-resource-creation-in-render/): resources built in a
  component body instead of an effect.
