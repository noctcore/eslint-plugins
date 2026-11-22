/**
 * Rule id → severity for the `recommended` preset. Keys carry the plugin
 * namespace.
 *
 * In the preset: the rules whose every report is a defect on any three.js or
 * React Three Fiber codebase, with no project fact needed.
 *
 * Left out, and listed in `tests/configs/recommended.test.ts`:
 * - `capability-probe-performance-caveat`: failing a WebGL check on software
 *   renderers is a product decision; an app whose whole point is the scene may
 *   prefer to run slowly over not running.
 * - `shadow-map-size-cap`: the right shadow budget depends on the devices a
 *   project targets, so its 2048 default is a starting point, not a fact.
 */
export const recommended = {
  'noctcore-three/instanced-mesh-needs-update': 'error',
  'noctcore-three/no-allocation-in-frame-loop': 'error',
  'noctcore-three/no-react-state-in-frame-loop': 'error',
  'noctcore-three/no-resource-creation-in-render': 'error',
  'noctcore-three/renderer-dpr-cap': 'error',
  'noctcore-three/require-dispose': 'error',
  'noctcore-three/update-projection-matrix-after-camera-change': 'error',
} as const;
