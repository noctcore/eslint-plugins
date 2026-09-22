import { ruleTester } from '@noctcore/eslint-test-utils';

import { componentFolderStructureRule } from '../../src/rules/component-folder-structure';

const COMPONENT = `export default function Widget() { return null; }`;

// Paths resolve relative to the package root (vitest cwd); the fixtures under
// tests/fixtures/components/** carry the sibling sets these cases assert on.
ruleTester.run('component-folder-structure', componentFolderStructureRule, {
  valid: [
    // A component folder whose full default sibling set is present on disk.
    {
      code: COMPONENT,
      filename: 'tests/fixtures/components/board/Complete/Complete.tsx',
    },
    // Nested component folders are still component folders and must be checked.
    {
      code: COMPONENT,
      filename:
        'tests/fixtures/components/onboarding/Onboarding/steps/DeepStep/DeepStep.tsx',
    },
    // Kebab-case file is not a component entry file — skipped.
    {
      code: COMPONENT,
      filename: 'apps/web/src/components/board/task-card.tsx',
    },
    // Basename does not equal parent folder — not a component entry file.
    {
      code: COMPONENT,
      filename: 'apps/web/src/components/board/Group/Widget.tsx',
    },
    // The default ignore glob (`**/ui/**`) keeps the lighter shadcn convention.
    {
      code: COMPONENT,
      filename: 'apps/web/src/components/ui/Button/Button.tsx',
    },
    // A component file outside the component root is not gated.
    {
      code: COMPONENT,
      filename: 'apps/web/src/routes/Widget/Widget.tsx',
    },
    // De-projecting: a narrower required set that the fixture satisfies.
    {
      code: COMPONENT,
      filename: 'tests/fixtures/components/board/Complete/Complete.tsx',
      options: [{ requiredSiblings: ['.stories.tsx', '.test.tsx'] }],
    },
    // De-projecting: mixing a literal (`index.ts`) and a name-relative suffix.
    {
      code: COMPONENT,
      filename: 'tests/fixtures/components/board/Complete/Complete.tsx',
      options: [{ requiredSiblings: ['.hooks.ts', 'index.ts'] }],
    },
    // De-projecting: with the default root (`components`), a `widgets/**` entry
    // is outside the root and therefore not gated (a bare folder passes).
    {
      code: COMPONENT,
      filename: 'tests/fixtures/widgets/panel/Bare/Bare.tsx',
    },
    // De-projecting: a custom `ignorePaths` can exclude any feature.
    {
      code: COMPONENT,
      filename: 'tests/fixtures/components/board/Widget/Widget.tsx',
      options: [{ ignorePaths: ['**/board/**'] }],
    },
  ],
  invalid: [
    // A component folder on disk that is missing its entire sibling set.
    {
      code: COMPONENT,
      filename: 'tests/fixtures/components/board/Widget/Widget.tsx',
      errors: [{ messageId: 'missingSiblings' }],
    },
    // A nested component folder on disk is also gated by the sibling set.
    {
      code: COMPONENT,
      filename:
        'tests/fixtures/components/onboarding/Onboarding/steps/ShallowStep/ShallowStep.tsx',
      errors: [{ messageId: 'missingSiblings' }],
    },
    // De-projecting: a custom `componentRoot` re-anchors the check onto a
    // `widgets/**` tree — the bare folder there now reports.
    {
      code: COMPONENT,
      filename: 'tests/fixtures/widgets/panel/Bare/Bare.tsx',
      options: [{ componentRoot: 'widgets' }],
      errors: [{ messageId: 'missingSiblings' }],
    },
    // De-projecting: a complete default folder still reds under a stricter
    // required set it does not satisfy (no `.parts.tsx` on disk).
    {
      code: COMPONENT,
      filename: 'tests/fixtures/components/board/Complete/Complete.tsx',
      options: [{ requiredSiblings: ['.parts.tsx'] }],
      errors: [{ messageId: 'missingSiblings' }],
    },
  ],
});
