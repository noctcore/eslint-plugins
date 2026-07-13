import { barrelPurityRule } from './barrel-purity';
import { colocatedTestRequiredRule } from './colocated-test-required';
import { componentFolderStructureRule } from './component-folder-structure';
import { filenameMatchesExportRule } from './filename-matches-export';
import { indexMustReexportDefaultRule } from './index-must-reexport-default';
import { maxImportDepthRule } from './max-import-depth';
import { noCrossFeatureImportsRule } from './no-cross-feature-imports';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'barrel-purity': barrelPurityRule,
  'colocated-test-required': colocatedTestRequiredRule,
  'component-folder-structure': componentFolderStructureRule,
  'filename-matches-export': filenameMatchesExportRule,
  'index-must-reexport-default': indexMustReexportDefaultRule,
  'max-import-depth': maxImportDepthRule,
  'no-cross-feature-imports': noCrossFeatureImportsRule,
};
