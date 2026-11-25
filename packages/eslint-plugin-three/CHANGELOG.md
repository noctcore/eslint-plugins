# @noctcore/eslint-plugin-three

## 0.1.0

### Minor Changes

- [#301](https://github.com/noctcore/eslint-plugins/pull/301) [`a0f06ae`](https://github.com/noctcore/eslint-plugins/commit/a0f06aef06c23a84d0e8d1092376853cee8af1e9) Thanks [@Shironex](https://github.com/Shironex)! - New package `@noctcore/eslint-plugin-three` for three.js and React Three Fiber code, starting at 0.1.0 with nine rules. They need no type information, and every rule except `capability-probe-performance-caveat` runs only in files that import `three`, a `three/*` subpath, `three-stdlib` or an `@react-three/*` package (add a project module that re-exports three.js through the `extraModules` option). A new install that spreads `recommended` turns on seven rules at `error`, so a scene with these defects fails lint from the first run:
  
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

### Patch Changes

- Updated dependencies [[`88d49c9`](https://github.com/noctcore/eslint-plugins/commit/88d49c9f5dc6366018dcc2cda9351426d873add3), [`e3cab3e`](https://github.com/noctcore/eslint-plugins/commit/e3cab3e9964f045e3072eef4674a7972cd211d1c)]:
  - @noctcore/eslint-utils@0.3.0
