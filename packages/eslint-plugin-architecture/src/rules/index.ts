import { componentFolderStructureRule } from './component-folder-structure';
import { indexMustReexportDefaultRule } from './index-must-reexport-default';
import { noCrossFeatureImportsRule } from './no-cross-feature-imports';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'component-folder-structure': componentFolderStructureRule,
  'index-must-reexport-default': indexMustReexportDefaultRule,
  'no-cross-feature-imports': noCrossFeatureImportsRule,
};
