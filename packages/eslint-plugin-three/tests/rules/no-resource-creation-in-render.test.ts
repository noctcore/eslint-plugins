import { ruleTester } from '@noctcore/eslint-test-utils';

import { noResourceCreationInRenderRule } from '../../src/rules/no-resource-creation-in-render';

const NS = "import * as THREE from 'three';\nimport { useMemo, useRef, useState, memo, forwardRef } from 'react';\n";
const TSX = 'src/Scene.tsx';

ruleTester.run('no-resource-creation-in-render', noResourceCreationInRenderRule, {
  valid: [
    // The fix: memoised.
    { code: `${NS}function Box() { const mat = useMemo(() => new THREE.MeshBasicMaterial(), []); return <mesh material={mat} />; }`, filename: TSX },
    // Lazy initialisers and refs.
    { code: `${NS}function Box() { const [geo] = useState(() => new THREE.BoxGeometry()); return <mesh geometry={geo} />; }`, filename: TSX },
    { code: `${NS}function Box() { const ref = useRef(new THREE.BoxGeometry()); return <mesh geometry={ref.current} />; }`, filename: TSX },
    // React's lazy ref idiom: the gate's probes.
    { code: `${NS}function Box() { const ref = useRef(null); if (ref.current === null) ref.current = new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`, filename: TSX },
    { code: `${NS}function Box() { const ref = useRef(null); ref.current ??= new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`, filename: TSX },
    { code: `${NS}function Box() { const ref = useRef(null); if (!ref.current) { ref.current = new THREE.TextureLoader(); } return null; }`, filename: TSX },
    { code: `${NS}function Box() { const ref = useRef(null); ref.current = ref.current ?? new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`, filename: TSX },
    { code: `${NS}function Box() { const ref = useRef(null); if (ref.current === undefined) ref.current = new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`, filename: TSX },
    // Module scope.
    { code: `${NS}const mat = new THREE.MeshBasicMaterial();\nfunction Box() { return <mesh material={mat} />; }`, filename: TSX },
    // Inside an effect or a handler.
    { code: `${NS}function Box() { useEffect(() => { const g = new THREE.BoxGeometry(); return () => g.dispose(); }, []); return null; }`, filename: TSX },
    { code: `${NS}function Box() { const onClick = () => load(new THREE.TextureLoader()); return <mesh onClick={onClick} />; }`, filename: TSX },
    // Math objects hold no GPU memory.
    { code: `${NS}function Box() { const v = new THREE.Vector3(); return <mesh position={v} />; }`, filename: TSX },
    // A vanilla factory: PascalCase, but no JSX and no hook.
    { code: `${NS}function Planet(radius: number) { const geo = new THREE.SphereGeometry(radius); return new THREE.Mesh(geo); }`, filename: 'src/planet.ts' },
    // A camelCase function is not a component.
    { code: `${NS}function makeBox() { return <mesh geometry={new THREE.BoxGeometry()} />; }`, filename: TSX },
    // A local class with a three.js name.
    { code: `class BoxGeometry {}\nfunction Box() { const g = new BoxGeometry(); return <mesh />; }`, filename: TSX },
    // Exempt file.
    {
      code: `${NS}function Box() { const mat = new THREE.MeshBasicMaterial(); return <mesh material={mat} />; }`,
      filename: '/repo/src/stories/Box.stories.tsx',
      options: [{ allowIn: ['**/*.stories.tsx'] }],
    },
  ],
  invalid: [
    {
      // A fallback in render builds a geometry on every render without the prop.
      code: `${NS}function Box(props) { const geo = props.geometry ?? new THREE.BoxGeometry(); return <mesh geometry={geo} />; }`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender' }],
    },
    {
      // A guard on another ref, or one with the wrong polarity.
      code: `${NS}function Box() { const myref = useRef(null); const ref = useRef(null); if (!myref.current) ref.current = new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender' }],
    },
    {
      code: `${NS}function Box() { const ref = useRef(null); if (flag) ref.current = new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender' }],
    },
    {
      code: `${NS}function Box() { const ref = useRef(null); if (ref.current !== null) ref.current = new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender' }],
    },
    {
      // Classes from a module in extraModules.
      code: "import { BoxGeometry } from '@acme/engine';\nfunction Box() { const geo = new BoxGeometry(); return <mesh geometry={geo} />; }",
      filename: TSX,
      options: [{ extraModules: ['@acme/engine'] }],
      errors: [{ messageId: 'resourceInRender' }],
    },
    {
      code: `${NS}function Box() { const mat = new THREE.MeshBasicMaterial(); return <mesh material={mat} />; }`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender', data: { name: 'MeshBasicMaterial', component: 'Box' } }],
    },
    {
      // Assigned to a ref on every render, with no guard.
      code: `${NS}function Box() { const ref = useRef(null); ref.current = new THREE.BoxGeometry(); return <mesh geometry={ref.current} />; }`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender' }],
    },
    {
      code: `${NS}const Box = () => <mesh geometry={new THREE.BoxGeometry(1, 1, 1)} />;`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender', data: { name: 'BoxGeometry', component: 'Box' } }],
    },
    {
      code: `import { TextureLoader } from 'three';\nimport { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';\nexport default function Model() {
        const loader = new GLTFLoader();
        const textures = new TextureLoader();
        const [gltf, setGltf] = useState(null);
        return null;
      }`,
      filename: TSX,
      errors: [
        { messageId: 'resourceInRender', data: { name: 'GLTFLoader', component: 'Model' } },
        { messageId: 'resourceInRender', data: { name: 'TextureLoader', component: 'Model' } },
      ],
    },
    {
      code: `${NS}const Glow = memo(function Glow() { const target = new THREE.WebGLRenderTarget(512, 512); return <group />; });`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender', data: { name: 'WebGLRenderTarget', component: 'Glow' } }],
    },
    {
      code: `${NS}const Card = forwardRef((props, ref) => { const tex = new THREE.CanvasTexture(canvas); return <mesh ref={ref} />; });`,
      filename: TSX,
      errors: [{ messageId: 'resourceInRender', data: { name: 'CanvasTexture', component: 'Card' } }],
    },
  ],
});
