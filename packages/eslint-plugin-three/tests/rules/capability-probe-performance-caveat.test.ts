import { ruleTester } from '@noctcore/eslint-test-utils';

import { capabilityProbePerformanceCaveatRule } from '../../src/rules/capability-probe-performance-caveat';

ruleTester.run('capability-probe-performance-caveat', capabilityProbePerformanceCaveatRule, {
  valid: [
    // The fix.
    "const ok = !!document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });",
    // An explicit false is a decision, not an omission.
    "if (canvas.getContext('webgl', { failIfMajorPerformanceCaveat: false })) mount();",
    // A context used to render, not a probe.
    "const gl = canvas.getContext('webgl2');\nconst renderer = new WebGLRenderer({ canvas, context: gl });",
    "function context() { return canvas.getContext('webgl2'); }",
    "const ctx = canvas.getContext('webgl2');\nif (!ctx) throw new Error('no webgl');\nctx.clearColor(0, 0, 0, 1);",
    // Options the rule cannot read.
    "if (canvas.getContext('webgl2', attributes)) mount();",
    "if (canvas.getContext('webgl2', { ...attributes })) mount();",
    // Not WebGL.
    "if (canvas.getContext('2d')) draw();",
    "if (canvas.getContext('webgpu')) mount();",
    // let can be reassigned later.
    "let gl = canvas.getContext('webgl'); if (!gl) gl = fallback();",
  ],
  invalid: [
    {
      code: "const supported = !!document.createElement('canvas').getContext('webgl2');",
      errors: [{ messageId: 'plainProbe', data: { kind: 'webgl2' } }],
    },
    {
      code: "export function hasWebGL() { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')); }",
      errors: [{ messageId: 'plainProbe' }],
    },
    {
      code: "if (canvas.getContext('webgl') !== null) mountScene(); else showPoster();",
      errors: [{ messageId: 'plainProbe', data: { kind: 'webgl' } }],
    },
    {
      code: "const ok = Boolean(canvas.getContext('experimental-webgl', { antialias: false }));",
      errors: [{ messageId: 'plainProbe', data: { kind: 'experimental-webgl' } }],
    },
    {
      code: `function probe() {
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return false;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
      }`,
      errors: [{ messageId: 'plainProbe' }, { messageId: 'plainProbe' }],
    },
    {
      code: "const can3d = canvas.getContext('webgl2') ? 'scene' : 'poster';",
      errors: [{ messageId: 'plainProbe' }],
    },
  ],
});
