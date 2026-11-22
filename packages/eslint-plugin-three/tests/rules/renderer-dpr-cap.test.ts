import { ruleTester } from '@noctcore/eslint-test-utils';

import { rendererDprCapRule } from '../../src/rules/renderer-dpr-cap';

const FIBER = "import { Canvas } from '@react-three/fiber';\n";

ruleTester.run('renderer-dpr-cap', rendererDprCapRule, {
  valid: [
    // Capped with Math.min at or below the cap.
    'renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));',
    'renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));',
    'renderer.setPixelRatio(Math.min(2, window.devicePixelRatio, 3));',
    // A fixed ratio within the cap.
    'renderer.setPixelRatio(1);',
    // Values the rule cannot read.
    'renderer.setPixelRatio(quality.dpr);',
    'renderer.setPixelRatio(pickDpr(window.devicePixelRatio));',
    'renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxDpr));',
    // A Canvas without dpr already defaults to [1, 2].
    { code: `${FIBER}const App = () => <Canvas camera={{ fov: 50 }} />;`, filename: 'src/App.tsx' },
    { code: `${FIBER}const App = () => <Canvas dpr={[1, 2]} />;`, filename: 'src/App.tsx' },
    { code: `${FIBER}const App = () => <Canvas dpr={1.5} />;`, filename: 'src/App.tsx' },
    { code: `${FIBER}const App = () => <Canvas dpr={[1, Math.min(window.devicePixelRatio, 2)]} />;`, filename: 'src/App.tsx' },
    // `dpr` on something that is not R3F's Canvas.
    { code: 'const App = () => <Canvas dpr={window.devicePixelRatio} />;', filename: 'src/App.tsx' },
    { code: `${FIBER}const App = () => <Chart dpr={3} />;`, filename: 'src/App.tsx' },
    // A raised cap.
    { code: 'renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));', options: [{ maxDpr: 3 }] },
    // A plain function named setPixelRatio is not a renderer method.
    'setPixelRatio(window.devicePixelRatio);',
    // Exempt file.
    {
      code: 'renderer.setPixelRatio(window.devicePixelRatio);',
      filename: '/repo/src/tools/screenshot.ts',
      options: [{ allowIn: ['**/tools/**'] }],
    },
  ],
  invalid: [
    {
      code: 'renderer.setPixelRatio(window.devicePixelRatio);',
      errors: [{ messageId: 'uncapped', data: { max: '2' } }],
    },
    { code: 'renderer.setPixelRatio(devicePixelRatio);', errors: [{ messageId: 'uncapped' }] },
    { code: 'composer.setPixelRatio(globalThis.devicePixelRatio!);', errors: [{ messageId: 'uncapped' }] },
    { code: 'renderer.setPixelRatio(Math.max(window.devicePixelRatio, 1));', errors: [{ messageId: 'uncapped' }] },
    {
      code: 'renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));',
      errors: [{ messageId: 'aboveCap', data: { value: '3', max: '2' } }],
    },
    { code: 'renderer.setPixelRatio(4);', errors: [{ messageId: 'aboveCap', data: { value: '4', max: '2' } }] },
    {
      code: 'renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));',
      options: [{ maxDpr: 1.5 }],
      errors: [{ messageId: 'aboveCap', data: { value: '2', max: '1.5' } }],
    },
    {
      code: `${FIBER}const App = () => <Canvas dpr={window.devicePixelRatio} />;`,
      filename: 'src/App.tsx',
      errors: [{ messageId: 'uncapped' }],
    },
    {
      code: `${FIBER}const App = () => <Canvas dpr={[1, 3]} />;`,
      filename: 'src/App.tsx',
      errors: [{ messageId: 'aboveCap', data: { value: '3', max: '2' } }],
    },
    {
      code: `${FIBER}const App = () => <Canvas dpr={[1, window.devicePixelRatio]} />;`,
      filename: 'src/App.tsx',
      errors: [{ messageId: 'uncapped' }],
    },
    {
      code: "import { Canvas as Scene } from '@react-three/fiber';\nconst App = () => <Scene dpr={3} />;",
      filename: 'src/App.tsx',
      errors: [{ messageId: 'aboveCap' }],
    },
    {
      code: `${FIBER}const App = () => <Canvas onCreated={({ gl }) => gl.setPixelRatio(window.devicePixelRatio)} />;`,
      filename: 'src/App.tsx',
      errors: [{ messageId: 'uncapped' }],
    },
  ],
});
