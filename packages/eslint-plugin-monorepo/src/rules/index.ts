import { noDeepPackageImportsRule } from './no-deep-package-imports';
import { noUnexportedSubpathImportRule } from './no-unexported-subpath-import';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'no-deep-package-imports': noDeepPackageImportsRule,
  'no-unexported-subpath-import': noUnexportedSubpathImportRule,
};
