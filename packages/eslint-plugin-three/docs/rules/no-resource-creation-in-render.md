# `noctcore-three/no-resource-creation-in-render`

> Geometries, materials, textures, render targets and loaders are not built in a component body.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A React component body runs on every render. A geometry, material, texture or render target
constructed there is a new GPU resource each time: the previous one is dropped without `dispose()`,
so GPU memory climbs with each re-render, and the new one is uploaded again. A loader built there
starts with an empty cache every time. Build the resource once:

```tsx bad filename=src/Box.tsx
import * as THREE from 'three';

export function Box({ color }: { color: string }) {
  const material = new THREE.MeshStandardMaterial({ color });
  return <mesh material={material} />;
}
```

```tsx good filename=src/Box.tsx
import { useMemo } from 'react';
import * as THREE from 'three';

export function Box({ color }: { color: string }) {
  const material = useMemo(() => new THREE.MeshStandardMaterial({ color }), [color]);
  return <mesh material={material} />;
}
```

## What it flags

`new X()` directly in the body of a component, where `X` is a `*Geometry`, `*Material`, `*Texture`,
`*RenderTarget` or `*Loader` class imported from `three`, or a loader imported from
`three/addons`, `three/examples/jsm` or `three-stdlib`.

A component is a PascalCase function (declared, assigned to a `const`, a default export, or
wrapped in `memo` / `forwardRef`) that contains JSX or calls a hook.

```tsx bad filename=src/Model.tsx reports=2
import { useState } from 'react';
import { TextureLoader } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function Model() {
  const gltfLoader = new GLTFLoader();
  const textureLoader = new TextureLoader();
  const [model] = useState(null);
  return null;
}
```

## What it does not flag

- Construction inside any nested function: `useMemo` and `useEffect` callbacks, lazy `useState`
  initialisers, event handlers.
- A resource passed straight to a hook (`useRef(new THREE.BoxGeometry())`): the extra instances are
  thrown away after the first render without ever reaching the GPU.
- Math objects (`Vector3`, `Color`), which hold no GPU memory.
- A PascalCase function with no JSX and no hook call, such as a vanilla three.js factory
  `function Planet() { return new Mesh(...) }`.

```tsx good filename=src/Model.tsx
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function Model() {
  const gltf = useLoader(GLTFLoader, '/model.glb');
  return <primitive object={gltf.scene} />;
}
```

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |

```js
'noctcore-three/no-resource-creation-in-render': ['error', { allowIn: ['**/*.stories.tsx'] }]
```

## When not to use it

A component that is guaranteed to render once (a static Storybook story) leaks nothing in
practice; put those files in `allowIn`.

## Related

- [`require-dispose`](../require-dispose/): resources built in an effect, which need their own
  `dispose()`.
- [`no-allocation-in-frame-loop`](../no-allocation-in-frame-loop/): the same resources built every frame.
