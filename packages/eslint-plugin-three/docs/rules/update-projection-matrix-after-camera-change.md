# `noctcore-three/update-projection-matrix-after-camera-change`

> A camera's projection fields are followed by `updateProjectionMatrix()` in the same function.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A camera renders through its projection matrix, and only `updateProjectionMatrix()` rebuilds it.
Assigning `fov`, `aspect`, `near`, `far`, `zoom` or an orthographic bound changes the property and
nothing on screen: after a resize the scene stays stretched, a zoom animation does nothing, a
clipping plane moved for a close-up never moves.

```ts bad
export function onResize(width: number, height: number) {
  camera.aspect = width / height;
  renderer.setSize(width, height);
}
```

```ts good
export function onResize(width: number, height: number) {
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}
```

## What it flags

An assignment (`=`, `+=` and the rest) to `fov`, `aspect`, `near`, `far`, `zoom`, `left`, `right`,
`top`, `bottom`, `filmGauge` or `filmOffset` on a receiver whose name matches `cameraNames`, when
nothing after it in the same function updates the projection.

The receiver's name is its last segment: `camera`, `this.camera`, `state.camera` and
`mainCamera` all match the default, and `cameraRef.current` reads as `camera`.

```ts bad reports=2
import { useFrame } from '@react-three/fiber';

useFrame(({ camera }) => {
  camera.zoom += 0.01;
});

export function closeUp() {
  const camera = rig.camera;
  camera.near = 0.01;
}
```

## What it does not flag

- Any `updateProjectionMatrix()` call after the assignment in the same function, on any receiver,
  so an alias (`const cam = ref.current`) is fine.
- `setFocalLength()`, `setLens()`, `setViewOffset()` and `clearViewOffset()` after it: they update
  the projection themselves.
- Handing the camera (or the object it hangs from, such as R3F's `state`) to any call after the
  assignment (`syncCamera(camera)`), which may update it.
- A method of a class that calls `updateProjectionMatrix()` in any of its methods (a resize
  handler that sets the bounds, an `update()` that runs every frame).
- A light's shadow camera (`light.shadow.camera`, or a `const` read from it). The renderer calls
  `updateProjectionMatrix()` on it when it first allocates the shadow map, so bounds set before
  the first render need no call. Changing them after that does need one, and is not detected.
- A function that writes the projection matrix by hand (`projectionMatrix.copy()`, `.set()`,
  `.elements[i] = ...`), as oblique clipping and off-axis projection code does.
- Receivers whose names do not look like a camera (`cameraSettings.fov`, `controls.zoom`), and
  fields that do not feed the projection (`position`, `focus`).

```ts good
import { useFrame } from '@react-three/fiber';

useFrame(({ camera }) => {
  camera.zoom += 0.01;
  camera.updateProjectionMatrix();
});

export function closeUp() {
  const camera = rig.camera;
  camera.near = 0.01;
  camera.updateProjectionMatrix();
}
```

Outside a class, an update in a different function (a resize handler that sets `aspect` while a
render loop calls `updateProjectionMatrix()` every frame) is reported: the rule reads one function
at a time. Call the update where the change is made, or put that file in `allowIn`.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `cameraNames` | `string` (regular expression) | `^(?:cam\|camera\|[A-Za-z_$][\w$]*Camera)$` | What the receiver's last name must match to count as a camera. Case sensitive, so `cameraSettings` does not match. |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |

```js
'noctcore-three/update-projection-matrix-after-camera-change': ['error', { cameraNames: '^(?:camera|eye|viewer)$' }]
```

## When not to use it

A codebase that updates every camera's projection once per frame in its render loop on purpose,
and never relies on the update at the change.
