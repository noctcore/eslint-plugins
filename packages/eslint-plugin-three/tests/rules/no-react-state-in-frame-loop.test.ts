import { ruleTester } from '@noctcore/eslint-test-utils';

import { noReactStateInFrameLoopRule } from '../../src/rules/no-react-state-in-frame-loop';

const R3F = "import { useState, useReducer, useRef } from 'react';\nimport { useFrame } from '@react-three/fiber';\n";

ruleTester.run('no-react-state-in-frame-loop', noReactStateInFrameLoopRule, {
  valid: [
    // The fix: mutate through a ref.
    `${R3F}function Box() {
      const ref = useRef(null);
      useFrame((_, delta) => { ref.current.rotation.y += delta; });
      return null;
    }`,
    // A guarded one-off transition.
    `${R3F}function Intro() {
      const [done, setDone] = useState(false);
      useFrame(({ clock }) => { if (!done && clock.elapsedTime > 2) setDone(true); });
      return null;
    }`,
    `${R3F}function Intro() {
      const [done, setDone] = useState(false);
      useFrame(({ clock }) => { clock.elapsedTime > 2 && setDone(true); });
      return null;
    }`,
    `${R3F}function Intro() {
      const [phase, setPhase] = useState(0);
      useFrame(() => { switch (phase) { case 0: setPhase(1); break; } });
      return null;
    }`,
    // An early return guards the call: the gate's probe.
    `${R3F}function Intro() {
      const [d, setD] = useState(false);
      useFrame(({ clock }) => { if (d || clock.elapsedTime < 2) return; setD(true); });
      return null;
    }`,
    `${R3F}function Box() {
      const [t, setT] = React.useState(0);
      useFrame(({ clock }) => { if (paused) { return; } setT(clock.elapsedTime); });
      return null;
    }`,
    // A setter outside the loop.
    `${R3F}function Box() {
      const [hovered, setHovered] = useState(false);
      useFrame(() => {});
      return <mesh onPointerOver={() => setHovered(true)} />;
    }`,
    // A function named like a setter that is not React state.
    `${R3F}function Box() {
      const setAngle = useStore((s) => s.setAngle);
      useFrame(() => setAngle(1));
      return null;
    }`,
    // The state value itself, not the setter.
    `${R3F}function Box() {
      const [angle, setAngle] = useState(0);
      useFrame(() => angle);
      return null;
    }`,
    // useFrame not from R3F.
    `import { useState } from 'react';\nfunction Box() { const [a, setA] = useState(0); useFrame(() => setA(1)); return null; }`,
  ],
  invalid: [
    {
      code: `${R3F}function Box() {
        const [angle, setAngle] = useState(0);
        useFrame(() => setAngle((a) => a + 0.01));
        return null;
      }`,
      errors: [{ messageId: 'stateInFrameLoop', data: { name: 'setAngle' } }],
    },
    {
      // An early return after the call does not guard it.
      code: `${R3F}function Box() {
        const [t, setT] = useState(0);
        useFrame(({ clock }) => { setT(clock.elapsedTime); if (paused) return; });
        return null;
      }`,
      errors: [{ messageId: 'stateInFrameLoop' }],
    },
    {
      code: `${R3F}function Box() {
        const [, dispatch] = useReducer(reducer, init);
        useFrame((state) => { dispatch({ type: 'tick', t: state.clock.elapsedTime }); });
        return null;
      }`,
      errors: [{ messageId: 'stateInFrameLoop', data: { name: 'dispatch' } }],
    },
    {
      code: `import { useState } from 'react';\nimport * as THREE from 'three';\nfunction Loop() {
        const [n, setN] = useState(0);
        useEffect(() => {
          function tick() { setN((x) => x + 1); requestAnimationFrame(tick); }
          tick();
        }, []);
        return null;
      }`,
      errors: [{ messageId: 'stateInFrameLoop' }],
    },
  ],
});
