import { ruleTester } from '@noctcore/eslint-test-utils';

import { barrelPurityRule } from '../../src/rules/barrel-purity';

const INDEX = 'src/components/Card/index.ts';

// The re-export that makes an `index.*` file a barrel; prefixed to the invalid cases.
const RE = `export { Card } from './Card';\n`;

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
    // An entry point named index.ts with no re-export is not a barrel.
    {
      code: `import { createServer } from './server';\nconst app = createServer();\napp.listen(3000);`,
      filename: 'src/index.ts',
    },
    // A plugin entry that builds an object and exports it with an imported binding.
    {
      code: `import { rules } from './rules';\nconst plugin = { rules };\nexport { rules };\nexport const configs = {};\nexport default plugin;`,
      filename: 'packages/plugin/src/index.ts',
    },
    // Without an `export … from`, an import-then-export file is treated as an entry point.
    {
      code: `import Card from './Card';\nexport default Card;\nconsole.log('loaded');`,
      filename: INDEX,
    },
    // `allow` glob exempts a whole barrel.
    {
      code: `export const legacy = 1;`,
      filename: 'packages/legacy/index.ts',
      options: [{ allow: ['**/legacy/**'] }],
    },
    // The same exemption under the standard `allowIn` name (`allow` is its deprecated alias).
    {
      code: `export const legacy = 1;`,
      filename: 'packages/legacy/index.ts',
      options: [{ allowIn: ['**/legacy/**'] }],
    },
  ],
  invalid: [
    // A local const declaration in a barrel; the re-export beside it is not reported.
    { code: RE + `export const x = 1;`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // A local function declaration.
    {
      code: RE + `export function build() { return 1; }`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // A local type alias declaration.
    {
      code: RE + `export type T = string;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // A default-exported value (not a re-export).
    {
      code: RE + `export default () => 1;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // A side-effect import.
    { code: RE + `import './styles.css';`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // A side-effect statement.
    { code: RE + `console.log('hi');`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // Plain non-export code.
    { code: RE + `const x = 1;`, filename: INDEX, errors: [{ messageId: 'impureBarrel' }] },
    // A star re-export makes the file a barrel too.
    {
      code: `export * from './Card.types';\nconsole.log('loaded');`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }],
    },
    // Multiple impure statements each report.
    {
      code: RE + `const a = 1;\nconst b = 2;`,
      filename: INDEX,
      errors: [{ messageId: 'impureBarrel' }, { messageId: 'impureBarrel' }],
    },
  ],
});
