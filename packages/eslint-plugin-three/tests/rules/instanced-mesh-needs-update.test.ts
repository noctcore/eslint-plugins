import { ruleTester } from '@noctcore/eslint-test-utils';

import { inThree } from '../inThree';

import { instancedMeshNeedsUpdateRule } from '../../src/rules/instanced-mesh-needs-update';

const IMPORT = "import { InstancedMesh, Object3D } from 'three';\n";

ruleTester.run('instanced-mesh-needs-update', instancedMeshNeedsUpdateRule, inThree({
  valid: [
    // The fix: the flag after the writes.
    `${IMPORT}function update(mesh: InstancedMesh) {}\nuseFrame(() => {
      for (let i = 0; i < count; i++) { ref.current.setMatrixAt(i, dummy.matrix); }
      ref.current.instanceMatrix.needsUpdate = true;
    });`,
    // A forEach loop and one flag around it.
    `${IMPORT}function place() {
      items.forEach((item, i) => { mesh.setMatrixAt(i, item.matrix); mesh.setColorAt(i, item.color); });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
    }`,
    // A helper that receives the mesh: its caller sets the flag.
    `${IMPORT}function write(mesh: InstancedMesh, i: number) { mesh.setMatrixAt(i, dummy.matrix); }`,
    // Built before it is ever rendered, then handed to the scene.
    `${IMPORT}function build() {
      const mesh = new InstancedMesh(geometry, material, 100);
      for (let i = 0; i < 100; i++) mesh.setMatrixAt(i, matrix);
      scene.add(mesh);
    }`,
    // A local helper writes, the function around it sets the flag.
    `${IMPORT}useFrame(() => {
      const m = ref.current;
      const place = (slot: number) => { m.setMatrixAt(slot, matrix); m.setColorAt(slot, tint); };
      for (let i = 0; i < 10; i++) place(i);
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });`,
    // One method writes, another sets the flag.
    `${IMPORT}class Batch {
      push(m: Matrix4) { this.mesh.setMatrixAt(this.n++, m); }
      end() { this.mesh.instanceMatrix.needsUpdate = true; }
    }`,
    // Built in a constructor.
    `${IMPORT}class Particles {
      constructor() {
        this.mesh = new InstancedMesh(geometry, material, 100);
        for (let i = 0; i < 100; i++) this.mesh.setMatrixAt(i, hidden);
      }
    }`,
    // Built and returned to the caller, never rendered yet.
    `${IMPORT}function build() {
      const mesh = new InstancedMesh(geometry, material, 100);
      for (let i = 0; i < 100; i++) mesh.setMatrixAt(i, matrix);
      return mesh;
    }`,
    `${IMPORT}function build() { this.mesh.setMatrixAt(0, matrix); return this.mesh; }`,
    // BatchedMesh uploads by itself.
    `${IMPORT}function f() { batchedMesh.setMatrixAt(id, matrix); }`,
    // A BatchedMesh whose name does not say so, resolved through its declaration.
    `${IMPORT}import type { BatchedMesh } from 'three';
    function Props() {
      const ref = useRef<BatchedMesh>(null!);
      useFrame(() => { ref.current.setMatrixAt(0, m); });
      return null;
    }`,
    `${IMPORT}class Props {
      build() { this.mesh = new BatchedMesh(10, 100, 300, material); }
      tick() { this.mesh.setMatrixAt(0, m); }
    }`,
    // No InstancedMesh anywhere in the file: some other setMatrixAt.
    'function f() { grid.setMatrixAt(0, m); }',
    // Exempt file.
    { code: `${IMPORT}function f() { mesh.setMatrixAt(0, m); }`, filename: '/repo/src/legacy/a.ts', options: [{ allowIn: ['**/legacy/**'] }] },
  ],
  invalid: [
    {
      code: `${IMPORT}useFrame(() => {
        for (let i = 0; i < count; i++) { ref.current.setMatrixAt(i, dummy.matrix); }
      });`,
      errors: [{ messageId: 'missingNeedsUpdate', data: { method: 'setMatrixAt', attribute: 'instanceMatrix', receiver: 'ref.current' } }],
    },
    {
      // The matrix flag is set, the color flag is not.
      code: `${IMPORT}function recolor() {
        mesh.setMatrixAt(0, m);
        mesh.setColorAt(0, c);
        mesh.instanceMatrix.needsUpdate = true;
      }`,
      errors: [{ messageId: 'missingNeedsUpdate', data: { method: 'setColorAt', attribute: 'instanceColor', receiver: 'mesh' } }],
    },
    {
      // R3F JSX names the mesh; reported once per function.
      code: `function Grid() {
        const ref = useRef();
        useLayoutEffect(() => {
          for (let i = 0; i < 10; i++) ref.current.setMatrixAt(i, m);
          ref.current.setMatrixAt(10, m);
        }, [layout]);
        return <instancedMesh ref={ref} args={[undefined, undefined, 11]} />;
      }`,
      errors: [{ messageId: 'missingNeedsUpdate' }],
    },
    {
      // A class that never sets the flag.
      code: `${IMPORT}class Swarm {
        tick() { for (let i = 0; i < 10; i++) this.mesh.setMatrixAt(i, m); }
      }`,
      errors: [{ messageId: 'missingNeedsUpdate', data: { method: 'setMatrixAt', attribute: 'instanceMatrix', receiver: 'this.mesh' } }],
    },
  ],
}));

ruleTester.run('instanced-mesh-needs-update outside three.js files', instancedMeshNeedsUpdateRule, {
  valid: ['// an InstancedMesh-like API from another engine\nfunction f() { mesh.setMatrixAt(0, m); }'],
  invalid: [],
});
