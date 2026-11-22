import { ruleTester } from '@noctcore/eslint-test-utils';

import { updateProjectionMatrixAfterCameraChangeRule } from '../../src/rules/update-projection-matrix-after-camera-change';

ruleTester.run('update-projection-matrix-after-camera-change', updateProjectionMatrixAfterCameraChangeRule, {
  valid: [
    // The fix: update after the change.
    `function onResize(w: number, h: number) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }`,
    // Several fields, one update.
    `function setLens() {
      this.camera.near = 0.1;
      this.camera.far = 500;
      this.camera.fov = 40;
      this.camera.updateProjectionMatrix();
    }`,
    // Through an alias.
    `useFrame(() => {
      const cam = cameraRef.current!;
      cameraRef.current!.fov = 30;
      cam.updateProjectionMatrix();
    });`,
    // Methods that update the projection themselves.
    'function zoomTo(mm: number) { camera.zoom = 2; camera.setFocalLength(mm); }',
    'function offset() { camera.aspect = 2; camera.setViewOffset(w, h, x, y, w2, h2); }',
    // Handed to a helper, which may update it.
    'function apply(settings: S) { camera.fov = settings.fov; syncCamera(camera); }',
    'useFrame((state) => { state.camera.fov = 30; commit(state); });',
    // The projection matrix is written by hand.
    `function mirror(camera) {
      virtualCamera.projectionMatrix.copy(camera.projectionMatrix);
      virtualCamera.far = camera.far;
    }`,
    `function offAxis() {
      camera.projectionMatrix.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      camera.fov = estimate;
    }`,
    // Shadow cameras: the renderer updates them when it allocates the map.
    'function setup() { light.shadow.camera.left = -20; light.shadow.camera.far = 50; }',
    `const light = useMemo(() => {
      const l = new DirectionalLight();
      const camera = l.shadow.camera;
      camera.left = camera.bottom = -5;
      camera.near = 1;
      return l;
    }, []);`,
    // Another method of the class updates it.
    `class Rig {
      setViewport(w: number, h: number) { this.camera.left = -w / 2; this.camera.right = w / 2; }
      update() { this.camera.updateProjectionMatrix(); }
    }`,
    // Not a camera by name.
    'cameraSettings.fov = 50;',
    'controls.zoom = 2;',
    'box.left = 10; layout.top = 0;',
    // Not a projection field.
    'camera.position.z = 5; camera.focus = 10;',
    // Reading, not assigning.
    'const fov = camera.fov;',
    // A custom name pattern.
    { code: 'eye.fov = 30;', options: [{ cameraNames: '^cam$' }] },
    // Exempt file.
    { code: 'camera.fov = 30;', filename: '/repo/src/legacy/scene.ts', options: [{ allowIn: ['**/legacy/**'] }] },
  ],
  invalid: [
    {
      code: `function onResize(w: number, h: number) {
        camera.aspect = w / h;
        renderer.setSize(w, h);
      }`,
      errors: [{ messageId: 'missingUpdate', data: { text: 'camera.aspect' } }],
    },
    {
      // Updated before the change, not after.
      code: 'function f() { camera.updateProjectionMatrix(); camera.fov = 40; }',
      errors: [{ messageId: 'missingUpdate' }],
    },
    {
      code: 'useFrame(({ camera }) => { camera.zoom = THREE.MathUtils.lerp(camera.zoom, 2, 0.1); });',
      errors: [{ messageId: 'missingUpdate', data: { text: 'camera.zoom' } }],
    },
    {
      // Reading the projection matrix is not writing it.
      code: 'function f() { const m = camera.projectionMatrix.clone(); camera.fov = 30; }',
      errors: [{ messageId: 'missingUpdate' }],
    },
    { code: 'cameraRef.current!.fov = 30;', errors: [{ messageId: 'missingUpdate' }] },
    {
      code: 'class Rig { setViewport(w: number) { this.camera.left = -w / 2; } }',
      errors: [{ messageId: 'missingUpdate' }],
    },
    {
      // A camera that is not a shadow camera, held in a const.
      code: 'function f() { const camera = rig.camera; camera.near = 0.5; }',
      errors: [{ messageId: 'missingUpdate' }],
    },
    { code: 'mainCamera.far += 100;', errors: [{ messageId: 'missingUpdate' }] },
    {
      // A different function updates it: the frame in between renders stale.
      code: 'function a() { camera.fov = 30; }\nfunction b() { camera.updateProjectionMatrix(); }',
      errors: [{ messageId: 'missingUpdate' }],
    },
    { code: 'eye.fov = 30;', options: [{ cameraNames: '^eye$' }], errors: [{ messageId: 'missingUpdate' }] },
  ],
});
