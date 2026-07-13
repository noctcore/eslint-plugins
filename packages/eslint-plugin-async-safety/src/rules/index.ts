import { forwardAbortSignalRule } from './forward-abort-signal';
import { noConcurrentSharedMutationRule } from './no-concurrent-shared-mutation';
import { noSharedMutableModuleStateRule } from './no-shared-mutable-module-state';
import { preferParallelAwaitsRule } from './prefer-parallel-awaits';
import { requireFetchTimeoutRule } from './require-fetch-timeout';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'require-fetch-timeout': requireFetchTimeoutRule,
  'forward-abort-signal': forwardAbortSignalRule,
  'no-shared-mutable-module-state': noSharedMutableModuleStateRule,
  'prefer-parallel-awaits': preferParallelAwaitsRule,
  'no-concurrent-shared-mutation': noConcurrentSharedMutationRule,
};
