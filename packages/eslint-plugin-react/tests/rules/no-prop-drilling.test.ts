import { ruleTester } from '@noctcore/eslint-test-utils';

import { noPropDrillingRule } from '../../src/rules/no-prop-drilling';

const FILENAME = 'Board.tsx';

// Four props forwarded unchanged to one child — the canonical drilling bundle.
const fourForwardedToOneChild = `
export function Board({ a, b, c, d }: BoardProps) {
  return <Column a={a} b={b} c={c} d={d} />;
}
`;

// Three forwards stay under the default threshold of 4.
const threeForwarded = `
export function Board({ a, b, c }: BoardProps) {
  return <Column a={a} b={b} c={c} />;
}
`;

// Four forwards SPLIT across two children never bundle (2 + 2).
const splitAcrossChildren = `
export function Board({ a, b, c, d }: BoardProps) {
  return (
    <>
      <Column a={a} b={b} />
      <Sidebar c={c} d={d} />
    </>
  );
}
`;

// Renamed forwards (`foo={bar}`) do not count — a rename is a deliberate
// remapping, not a wire.
const renamedForwards = `
export function Board({ a, b, c, d }: BoardProps) {
  return <Column w={a} x={b} y={c} z={d} />;
}
`;

// Spread forwarding is out of scope (the rest element is not a named prop).
const spreadForwarding = `
export function Board({ a, ...rest }: BoardProps) {
  return <Column a={a} {...rest} />;
}
`;

// A prop with ANY local use is disqualified — only pure pass-throughs bundle.
const locallyUsedProp = `
export function Board({ a, b, c, d }: BoardProps) {
  const label = a.toUpperCase();
  return <Column a={a} b={b} c={c} d={d} title={label} />;
}
`;

// Forwarding to a lowercase (DOM) element is consumption, not drilling.
const domForwarding = `
export function Board({ id, className, style, title }: BoardProps) {
  return <div id={id} className={className} style={style} title={title} />;
}
`;

// Arrow-function component form.
const arrowComponent = `
export const Board = ({ a, b, c, d }: BoardProps) => (
  <Column a={a} b={b} c={c} d={d} />
);
`;

// Five forwards to the same child among other attributes still red.
const fiveAmongOthers = `
export function Board({ a, b, c, d, e, onPick }: BoardProps) {
  const handlePick = () => onPick('x');
  return <Column a={a} b={b} c={c} d={d} e={e} onPick={handlePick} />;
}
`;

ruleTester.run('no-prop-drilling', noPropDrillingRule, {
  valid: [
    { code: threeForwarded, filename: FILENAME },
    { code: splitAcrossChildren, filename: FILENAME },
    { code: renamedForwards, filename: FILENAME },
    { code: spreadForwarding, filename: FILENAME },
    { code: locallyUsedProp, filename: FILENAME },
    { code: domForwarding, filename: FILENAME },
    // A raised threshold permits the bundle.
    { code: fourForwardedToOneChild, filename: FILENAME, options: [{ maxForwarded: 5 }] },
    // A param not annotated `*Props` is not a props contract.
    {
      code: `export function Board({ a, b, c, d }: BoardArgs) { return <Column a={a} b={b} c={c} d={d} />; }`,
      filename: FILENAME,
    },
  ],
  invalid: [
    {
      code: fourForwardedToOneChild,
      filename: FILENAME,
      errors: [{ messageId: 'forwardedBundle' }],
    },
    { code: arrowComponent, filename: FILENAME, errors: [{ messageId: 'forwardedBundle' }] },
    { code: fiveAmongOthers, filename: FILENAME, errors: [{ messageId: 'forwardedBundle' }] },
    // Multiple children: only the over-threshold bundle reds (4 to Column, 2 to
    // Sidebar → exactly one report).
    {
      code: `
export function Board({ a, b, c, d, e, f }: BoardProps) {
  return (
    <>
      <Column a={a} b={b} c={c} d={d} />
      <Sidebar e={e} f={f} />
    </>
  );
}
`,
      filename: FILENAME,
      errors: [{ messageId: 'forwardedBundle' }],
    },
    // A lowered threshold tightens the tripwire.
    {
      code: threeForwarded,
      filename: FILENAME,
      options: [{ maxForwarded: 3 }],
      errors: [{ messageId: 'forwardedBundle' }],
    },
  ],
});
