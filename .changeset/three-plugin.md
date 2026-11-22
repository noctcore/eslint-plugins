---
'@noctcore/eslint-plugin-three': minor
---

New package `@noctcore/eslint-plugin-three` for three.js and React Three Fiber code, starting at 0.1.0 with nine rules. They need no type information, and every rule except `capability-probe-performance-caveat` runs only in files that import `three`, a `three/*` subpath, `three-stdlib` or an `@react-three/*` package (add a project module that re-exports three.js through the `extraModules` option). A new install that spreads `recommended` turns on seven rules at `error`, so a scene with these defects fails lint from the first run:

- `renderer-dpr-cap`: `setPixelRatio(window.devicePixelRatio)`, `Math.max(devicePixelRatio, n)`, and a literal ratio or `Math.min` cap above `maxDpr` (default 2), in `setPixelRatio()` and R3F `<Canvas dpr>`. A Canvas without `dpr` is fine, because R3F defaults to `[1, 2]`.
- `require-dispose`: a geometry, material, texture or render target created in `useEffect` / `useLayoutEffect`, put in the scene or followed by a cleanup, and never disposed. Resources that leave the effect, or that the cleanup hands to a disposal helper, are left alone.
- `no-resource-creation-in-render`: the same resources, and loaders, constructed directly in a component body. React's lazy ref idiom (`if (ref.current === null) ref.current = new X()`, `ref.current ??= new X()`) is allowed.
- `no-allocation-in-frame-loop`: `new Vector3()` and the other math classes, or a GPU resource, inside `useFrame`, `setAnimationLoop` or a self-scheduling `requestAnimationFrame` function. Lazy initialisation, including behind an early return, is allowed.
- `no-react-state-in-frame-loop`: a `useState` setter or `useReducer` dispatch called unconditionally in a frame loop (not under a condition or after an early return).
- `update-projection-matrix-after-camera-change`: `fov`, `aspect`, `near`, `far`, `zoom` or an orthographic bound assigned on a camera with no `updateProjectionMatrix()` after it in the same function.
- `instanced-mesh-needs-update`: `setMatrixAt()` / `setColorAt()` with no `instanceMatrix.needsUpdate` / `instanceColor.needsUpdate` in the same function.

Two opt-in rules, left out of `recommended`:

- `capability-probe-performance-caveat`: a WebGL `getContext()` support check without `failIfMajorPerformanceCaveat: true`, which passes on software renderers.
- `shadow-map-size-cap`: a literal `shadow.mapSize` above `maxMapSize` (default 2048), in code or R3F `shadow-mapSize` props.
