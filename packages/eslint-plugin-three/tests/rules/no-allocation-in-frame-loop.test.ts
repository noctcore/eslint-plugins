import { ruleTester } from '@noctcore/eslint-test-utils';

import { noAllocationInFrameLoopRule } from '../../src/rules/no-allocation-in-frame-loop';

const R3F = "import * as THREE from 'three';\nimport { useFrame } from '@react-three/fiber';\n";
const VANILLA = "import { Vector3, Color, BoxGeometry } from 'three';\n";

ruleTester.run('no-allocation-in-frame-loop', noAllocationInFrameLoopRule, {
  valid: [
    // The fix: hoisted to module scope and reused.
    `${R3F}const target = new THREE.Vector3(0, 1, 0);
    function Box() {
      useFrame(() => { mesh.current.position.lerp(target, 0.1); });
      return null;
    }`,
    // Built in a ref or memo, outside the loop.
    `${R3F}function Box() {
      const v = useMemo(() => new THREE.Vector3(), []);
      useFrame(() => { v.set(0, 1, 0); });
      return null;
    }`,
    // Lazy initialisation runs once.
    `${R3F}useFrame(() => { tmp.current ??= new THREE.Vector3(); tmp.current.set(1, 2, 3); });`,
    `${R3F}useFrame(() => { if (!tmp.current) tmp.current = new THREE.Vector3(); });`,
    `${R3F}useFrame(() => { const v = cache.v ?? new THREE.Vector3(); });`,
    // Lazy initialisation behind an early return: the gate's probe.
    `${R3F}useFrame(() => { if (v.current) return; v.current = new THREE.Vector3(); });`,
    // A one-shot requestAnimationFrame is not a loop.
    `${VANILLA}requestAnimationFrame(() => { camera.position.copy(new Vector3(0, 0, 5)); });`,
    // A loop that does not reschedule itself by name.
    `${VANILLA}function step() { const v = new Vector3(); }\nrequestAnimationFrame(other);`,
    // A useFrame not imported from R3F.
    "import { Vector3 } from 'three';\nuseFrame(() => { const v = new Vector3(); });",
    // A local class with a three.js name.
    `import { useFrame } from '@react-three/fiber';\nclass Vector3 {}\nuseFrame(() => { const v = new Vector3(); });`,
    // Not a math or resource class.
    `${R3F}useFrame(() => { const m = new Map(); const g = new THREE.Group(); });`,
    // A helper declared inside the loop is not run by it.
    `${R3F}useFrame(() => { function later() { return new THREE.Vector3(); } register(later); });`,
    // Outside the loop in the same component.
    `${R3F}function Box() { const onClick = () => new THREE.Vector3(); useFrame(() => {}); return null; }`,
    // Exempt file.
    {
      code: `${R3F}useFrame(() => { const v = new THREE.Vector3(); });`,
      filename: '/repo/src/demos/spin.tsx',
      options: [{ allowIn: ['**/demos/**'] }],
    },
  ],
  invalid: [
    {
      code: `${R3F}function Box() {
        useFrame(() => { mesh.current.position.lerp(new THREE.Vector3(0, 1, 0), 0.1); });
        return null;
      }`,
      errors: [{ messageId: 'mathAllocation', data: { name: 'Vector3' } }],
    },
    {
      // Inside an array callback in the loop.
      code: `${R3F}useFrame(() => { items.forEach((item) => item.color.lerp(new THREE.Color('red'), 0.1)); });`,
      errors: [{ messageId: 'mathAllocation', data: { name: 'Color' } }],
    },
    {
      // Reassigned every frame without a guard.
      code: `${R3F}useFrame(() => { tmp.current = new THREE.Quaternion(); });`,
      errors: [{ messageId: 'mathAllocation', data: { name: 'Quaternion' } }],
    },
    {
      code: `${R3F}useFrame(() => { mesh.current.geometry = new THREE.BoxGeometry(1, 1, 1); });`,
      errors: [{ messageId: 'resourceAllocation', data: { name: 'BoxGeometry' } }],
    },
    {
      // Vanilla: a self-scheduling function.
      code: `${VANILLA}function animate() {
        requestAnimationFrame(animate);
        mesh.position.add(new Vector3(0, 0.01, 0));
        renderer.render(scene, camera);
      }`,
      errors: [{ messageId: 'mathAllocation' }],
    },
    {
      code: `${VANILLA}const tick = () => { const c = new Color(0xff0000); window.requestAnimationFrame(tick); };`,
      errors: [{ messageId: 'mathAllocation' }],
    },
    {
      code: `${VANILLA}renderer.setAnimationLoop(() => { const v = new Vector3(); });`,
      errors: [{ messageId: 'mathAllocation' }],
    },
    {
      // By name.
      code: `${VANILLA}function render() { const g = new BoxGeometry(); }\nrenderer.setAnimationLoop(render);`,
      errors: [{ messageId: 'resourceAllocation' }],
    },
    {
      // setAnimationLoop(tick) resolves `tick` through scope: only the passed one is a loop.
      code: `${VANILLA}function start() {
        function tick() { const v = new Vector3(); }
        renderer.setAnimationLoop(tick);
      }
      function other() {
        function tick() { const v = new Vector3(); }
        register(tick);
      }`,
      errors: [{ messageId: 'mathAllocation', line: 3 }],
    },
    {
      // An early return that tests something else does not make it lazy.
      code: `${R3F}useFrame(() => { if (paused) return; v.current = new THREE.Vector3(); });`,
      errors: [{ messageId: 'mathAllocation' }],
    },
    {
      // A class method that reschedules itself.
      code: `${VANILLA}class App {
        animate = () => {
          requestAnimationFrame(this.animate);
          this.mesh.position.copy(new Vector3());
        };
        loop() {
          requestAnimationFrame(() => this.loop());
          const v = new Vector3();
        }
      }`,
      errors: [{ messageId: 'mathAllocation' }, { messageId: 'mathAllocation' }],
    },
  ],
});

ruleTester.run('no-allocation-in-frame-loop outside three.js files', noAllocationInFrameLoopRule, {
  valid: [
    // No import of three or R3F: some other engine's loop.
    "import { Vector3 } from '@babylonjs/core';\nengine.runRenderLoop(() => {});\nfunction tick() { requestAnimationFrame(tick); const v = new Vector3(); }",
  ],
  invalid: [],
});
