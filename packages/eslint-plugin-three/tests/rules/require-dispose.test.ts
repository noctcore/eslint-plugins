import { ruleTester } from '@noctcore/eslint-test-utils';

import { requireDisposeRule } from '../../src/rules/require-dispose';

const NS = "import * as THREE from 'three';\nimport { useEffect, useLayoutEffect } from 'react';\n";

ruleTester.run('require-dispose', requireDisposeRule, {
  valid: [
    // The fix.
    `${NS}useEffect(() => {
      const geometry = new THREE.BoxGeometry();
      const material = new THREE.MeshStandardMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      return () => { scene.remove(mesh); geometry.dispose(); material.dispose(); };
    }, [scene]);`,
    // Disposed through the holder.
    `${NS}useEffect(() => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
      const geometry = new THREE.PlaneGeometry();
      const plane = new THREE.Mesh(geometry, material);
      scene.add(plane);
      return () => { scene.remove(plane); plane.geometry.dispose(); };
    }, []);`,
    // A shared disposer, or a scene walk, in the cleanup.
    `${NS}useEffect(() => {
      const geometry = new THREE.BoxGeometry();
      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      return () => disposeObject(mesh);
    }, []);`,
    `${NS}useEffect(() => {
      const geometry = new THREE.BoxGeometry();
      group.add(new THREE.Mesh(geometry, material));
      return () => group.traverse((o) => o.geometry?.dispose());
    }, []);`,
    // A disposal helper over the children, with a shared geometry used through a ternary.
    `${NS}useEffect(() => {
      const geometry = new THREE.SphereGeometry(1, 16, 12);
      points.forEach((point, i) => {
        const handle = new THREE.Mesh(i === 0 ? geometry : geometry.clone(), material);
        handles.add(handle);
      });
      return () => {
        for (const child of [...handles.children]) { handles.remove(child); disposeObject(child); }
      };
    }, [points]);`,
    // Leaves the effect: someone else owns it.
    `${NS}useEffect(() => {
      const geometry = new THREE.BoxGeometry();
      geometryRef.current = geometry;
      return () => {};
    }, []);`,
    `${NS}useEffect(() => {
      const texture = new THREE.DataTexture(data, 4, 4);
      setTexture(texture);
      return () => {};
    }, []);`,
    `${NS}useEffect(() => {
      const target = new THREE.WebGLRenderTarget(256, 256);
      targets.push(target);
      return () => {};
    }, []);`,
    // Never added and no cleanup: never uploaded.
    `${NS}useEffect(() => {
      const geometry = new THREE.BoxGeometry();
      console.log(geometry.attributes.position.count);
    }, []);`,
    // Disposed in the body after use.
    `${NS}useEffect(() => {
      const temp = new THREE.SphereGeometry();
      merged.current = merge(base, temp.clone());
      temp.dispose();
      return () => {};
    }, []);`,
    // Not an effect.
    `${NS}const geometry = useMemo(() => new THREE.BoxGeometry(), []);`,
    // Math objects hold no GPU memory.
    `${NS}useEffect(() => { const v = new THREE.Vector3(); return () => {}; }, []);`,
    // A local class with a three.js name.
    `import { useEffect } from 'react';\nclass BoxGeometry {}\nuseEffect(() => { const g = new BoxGeometry(); return () => {}; }, []);`,
  ],
  invalid: [
    {
      // Classes from a module in extraModules.
      code: `import { BoxGeometry, Mesh } from '@acme/engine';
      useEffect(() => {
        const geometry = new BoxGeometry();
        scene.add(new Mesh(geometry, material));
      }, []);`,
      options: [{ extraModules: ['@acme/engine'] }],
      errors: [{ messageId: 'notDisposed', data: { name: 'geometry', className: 'BoxGeometry' } }],
    },
    {
      code: `${NS}useEffect(() => {
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshStandardMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
        return () => { scene.remove(mesh); };
      }, [scene]);`,
      errors: [
        { messageId: 'notDisposed', data: { name: 'geometry', className: 'BoxGeometry' } },
        { messageId: 'notDisposed', data: { name: 'material', className: 'MeshStandardMaterial' } },
      ],
    },
    {
      // Added to the scene, no cleanup at all.
      code: `${NS}useLayoutEffect(() => {
        const geometry = new THREE.PlaneGeometry(10, 10);
        scene.add(new THREE.Mesh(geometry, material));
      }, []);`,
      errors: [{ messageId: 'notDisposed', data: { name: 'geometry', className: 'PlaneGeometry' } }],
    },
    {
      // A texture held by a local material that is disposed: the texture is not.
      code: `${NS}useEffect(() => {
        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial();
        material.map = texture;
        const sprite = new THREE.Sprite(material);
        scene.add(sprite);
        return () => { scene.remove(sprite); material.dispose(); };
      }, []);`,
      errors: [{ messageId: 'notDisposed', data: { name: 'texture', className: 'CanvasTexture' } }],
    },
    {
      code: `${NS}React.useEffect(() => {
        const target = new THREE.WebGLRenderTarget(512, 512);
        return () => { composer.reset(); };
      }, []);`,
      errors: [{ messageId: 'notDisposed', data: { name: 'target', className: 'WebGLRenderTarget' } }],
    },
  ],
});
