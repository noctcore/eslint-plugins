import { ruleTester } from '@noctcore/eslint-test-utils';

import { noCrossFeatureImportsRule } from '../../src/rules/no-cross-feature-imports';

const FROM = 'apps/web/src/components/board/Board/Board.tsx';
// A file under a custom `features/` root, for the de-projecting cases.
const FROM_FEATURES = 'apps/web/src/features/board/Board/Board.tsx';

ruleTester.run('no-cross-feature-imports', noCrossFeatureImportsRule, {
  valid: [
    // Same feature via alias.
    {
      code: `import { x } from '@/components/board/TaskCard';`,
      filename: FROM,
    },
    // Same feature via relative path.
    {
      code: `import { TaskCard } from '../TaskCard/TaskCard';`,
      filename: FROM,
    },
    // Shared feature (ui) is importable by all.
    {
      code: `import { Button } from '@/components/ui/Button';`,
      filename: FROM,
    },
    // Type-only cross-feature import is allowed by default.
    {
      code: `import type { ProjectSummary } from '@/components/projects/ProjectCard/ProjectCard.types';`,
      filename: FROM,
    },
    // Non-feature imports (lib, hooks) are fine.
    {
      code: `import { cn } from '@/lib/utils';`,
      filename: FROM,
    },
    // A bare package specifier is not a feature import.
    {
      code: `import { z } from 'zod';`,
      filename: FROM,
    },
    // Files outside any feature are not constrained.
    {
      code: `import { ProjectCard } from '@/components/projects/ProjectCard';`,
      filename: 'apps/web/src/routes/projects.tsx',
    },
    // Dynamic import within the same feature is fine.
    {
      code: `const mod = import('@/components/board/TaskCard');`,
      filename: FROM,
    },
    // Dynamic import of the shared feature is fine.
    {
      code: `const mod = import('@/components/ui/Button');`,
      filename: FROM,
    },
    // Re-exporting the same feature (the barrel pattern) is fine.
    {
      code: `export { TaskCard } from './TaskCard/TaskCard';`,
      filename: 'apps/web/src/components/board/index.ts',
    },
    // Re-exporting non-feature code is not this rule's concern.
    {
      code: `export { cn } from '@/lib/utils';`,
      filename: FROM,
    },
    // A non-literal dynamic import source cannot be resolved statically.
    {
      code: `const name = '@/components/projects/ProjectCard';\nconst mod = import(name);`,
      filename: FROM,
    },
    // Type-only re-export is allowed under the default allowTypeImports.
    {
      code: `export type { ProjectSummary } from '@/components/projects/ProjectCard/ProjectCard.types';`,
      filename: FROM,
    },
    // De-projecting: a custom alias + featureRoot, same feature via alias.
    {
      code: `import { x } from '~/features/board/TaskCard';`,
      filename: FROM_FEATURES,
      options: [{ featureRoot: 'features', alias: '~/features' }],
    },
    // De-projecting: a custom shared-feature allowlist permits `shared`.
    {
      code: `import { Thing } from '@/components/shared/Thing';`,
      filename: FROM,
      options: [{ sharedFeatures: ['shared'] }],
    },
  ],
  invalid: [
    // Runtime cross-feature import via alias.
    {
      code: `import { ProjectCard } from '@/components/projects/ProjectCard';`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Runtime cross-feature import via relative path.
    {
      code: `import { ProjectCard } from '../../projects/ProjectCard/ProjectCard';`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Type-only import disallowed once allowTypeImports is off.
    {
      code: `import type { ProjectSummary } from '@/components/projects/ProjectCard/ProjectCard.types';`,
      filename: FROM,
      options: [{ allowTypeImports: false }],
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Dynamic `import()` cannot lazy-load a sibling feature invisibly.
    {
      code: `const mod = import('@/components/projects/ProjectCard');`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Dynamic import via a relative path that climbs into another feature.
    {
      code: `const mod = import('../../projects/ProjectCard/ProjectCard');`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // `export … from` re-export laundering is a cross-feature import.
    {
      code: `export { ProjectCard } from '@/components/projects/ProjectCard';`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // `export * from` re-export laundering too.
    {
      code: `export * from '@/components/projects/ProjectCard';`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Type-only re-export reds once allowTypeImports is off.
    {
      code: `export type { ProjectSummary } from '@/components/projects/ProjectCard/ProjectCard.types';`,
      filename: FROM,
      options: [{ allowTypeImports: false }],
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // De-projecting: a custom alias catches cross-feature imports.
    {
      code: `import { X } from '~/features/projects/X';`,
      filename: FROM_FEATURES,
      options: [{ featureRoot: 'features', alias: '~/features' }],
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // De-projecting: a custom featureRoot resolves relative cross-feature climbs.
    {
      code: `import { X } from '../../projects/ProjectCard/ProjectCard';`,
      filename: FROM_FEATURES,
      options: [{ featureRoot: 'features' }],
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // De-projecting: emptying the shared allowlist makes `ui` a normal feature.
    {
      code: `import { Button } from '@/components/ui/Button';`,
      filename: FROM,
      options: [{ sharedFeatures: [] }],
      errors: [{ messageId: 'crossFeatureImport' }],
    },
  ],
});
