import { ruleTester } from '@noctcore/eslint-test-utils';

import { barrelPurityRule } from '../../src/rules/barrel-purity';

const INDEX = 'src/components/Card/index.ts';

ruleTester.run('barrel-purity', barrelPurityRule, {
  valid: [
    // Named re-export from another module.
    { code: `export { Card } from './Card';`, filename: INDEX },
    // Star and namespace re-exports.
    { code: `export * from './Card.types';`, filename: INDEX },
    { code: `export * as card from './Card';`, filename: INDEX },
    // Default re-export via the specifier form.
    { code: `export { default as Card } from './Card';`, filename: INDEX },
    // Specifier-only re-export of imported bindings.
    { code: `import { a, b } from './mod';\nexport { a, b };`, filename: INDEX },
    // Type-only re-export.
    { code: `export type { Props } from './Card.types';`, filename: INDEX },
    // Default re-export of an imported binding by name.
    { code: `import Card from './Card';\nexport default Card;`, filename: INDEX },
    // Not a barrel file — logic here is none of this rule's business.
    { code: `export const helper = 1;\nconst x = 2;`, filename: 'src/components/Card/helper.ts' },
    // `.tsx` barrels are covered but pure ones pass.
    { code: `export { Card } from './Card';`, filename: 'src/components/Card/index.tsx' },
    // `allow` glob exempts a whole barrel.
    {
      code: `export const legacy = 1;`,
      filename: 'packages/legacy/index.ts',
      options: [{ allow: ['**/legacy/**'] }],
    },
  ],
  invalid: [
    // A local const declaration in a barrel.
    { code: `export const x = 1;`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // A local function declaration.
    {
      code: `export function build() { return 1; }`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // A local type alias declaration.
    {
      code: `export type T = string;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // A default-exported value (not a re-export).
    {
      code: `export default () => 1;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // A side-effect import.
    { code: `import './styles.css';`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // A side-effect statement.
    { code: `console.log('hi');`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // Plain non-export code.
    { code: `const x = 1;`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // A pure re-export next to an impure declaration reports only the impurity.
    {
      code: `export { Card } from './Card';\nexport const x = 1;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // Multiple impure statements each report.
    {
      code: `const a = 1;\nconst b = 2;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }, { messageId: 'impureBarrel' }],
    },
  ],
});
