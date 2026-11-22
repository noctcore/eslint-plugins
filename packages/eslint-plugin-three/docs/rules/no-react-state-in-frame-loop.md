# `noctcore-three/no-react-state-in-frame-loop`

> No React state setter called on every frame.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

A state setter schedules a render of the component and everything under it. Called from a frame
loop it does that 60 to 120 times a second, routing every animated value through React's
reconciler instead of writing it to the object. R3F's own docs list it as the first pitfall: keep
per-frame values in refs and mutate the object.

```tsx bad filename=src/Spinner.tsx
import { useState } from 'react';
import { useFrame } from '@react-three/fiber';

export function Spinner() {
  const [angle, setAngle] = useState(0);
  useFrame((_, delta) => setAngle((a) => a + delta));
  return <mesh rotation-y={angle} />;
}
```

```tsx good filename=src/Spinner.tsx
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';

export function Spinner() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta;
  });
  return <mesh ref={ref} />;
}
```

## What it flags

A call to the setter of a `useState` or the dispatch of a `useReducer` (`React.useState` too),
resolved through scope so a function that only shares the name does not count, made
unconditionally inside a frame loop: R3F's `useFrame` callback, `renderer.setAnimationLoop()`'s
callback, or a function that schedules itself with `requestAnimationFrame(name)`. The rule runs
in files that import `three` or `@react-three/fiber`.

```tsx bad filename=src/Clock.tsx
import { useReducer } from 'react';
import { useFrame } from '@react-three/fiber';

export function Clock() {
  const [, dispatch] = useReducer(reducer, initial);
  useFrame(({ clock }) => {
    dispatch({ type: 'tick', time: clock.elapsedTime });
  });
  return null;
}
```

## What it does not flag

- Files that import neither `three` (or a `three/*` subpath), `three-stdlib`, an
  `@react-three/*` package nor one of `extraModules`: the rule only runs in three.js code, so
  another engine's API with the same names (a Phaser or Babylon camera) is never read as three.js.
  Only static `import` declarations count: a file that loads three.js only through `import()` or
  `require()` is skipped, which can hide a report but never adds one.
- A setter under an `if`, a `? :`, a `&&` / `||` / `??` or a `switch` case, or after an early
  return (`if (done || clock.elapsedTime < 2) return;`). That is the shape of a one-off
  transition, such as ending an intro after two seconds.
- Setters of stores (zustand `set`, signals), which are not React state.
- Setters outside the loop: event handlers, effects.

```tsx good filename=src/Clock.tsx
import { useState } from 'react';
import { useFrame } from '@react-three/fiber';

export function Clock() {
  const [done, setDone] = useState(false);
  useFrame(({ clock }) => {
    if (!done && clock.elapsedTime > 2) setDone(true);
  });
  return null;
}
```

An early return counts as a guard whatever it tests, so `if (paused) return; setTime(t)` is not
reported even though it runs on every unpaused frame: precision over coverage.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `allowIn` | `string[]` (globs) | `[]` | Files the rule skips, matched against the absolute path and the path relative to the working directory or workspace root. |
| `extraModules` | `string[]` | `[]` | More module specifiers that mark a file as three.js code (a project module that re-exports three.js, such as `@acme/engine`); subpaths match too, and their imports count as three.js classes and R3F hooks. |

```js
'noctcore-three/no-react-state-in-frame-loop': ['error', { allowIn: ['**/debug/**'] }]
```

## When not to use it

A debug overlay that shows a live frame counter through state may accept the cost; put it in
`allowIn`.

## Related

- [`no-allocation-in-frame-loop`](../no-allocation-in-frame-loop/): allocations in the same loops.
