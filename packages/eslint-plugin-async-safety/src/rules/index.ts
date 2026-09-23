import { forwardAbortSignalRule } from './forward-abort-signal';
import { noConcurrentSharedMutationRule } from './no-concurrent-shared-mutation';
import { noLeakyRaceTimeoutRule } from './no-leaky-race-timeout';
import { noSharedMutableModuleStateRule } from './no-shared-mutable-module-state';
import { preferParallelAwaitsRule } from './prefer-parallel-awaits';
import { requireClientTimeoutRule } from './require-client-timeout';
import { requireFetchTimeoutRule } from './require-fetch-timeout';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'require-fetch-timeout': requireFetchTimeoutRule,
  'require-client-timeout': requireClientTimeoutRule,
  'forward-abort-signal': forwardAbortSignalRule,
  'no-shared-mutable-module-state': noSharedMutableModuleStateRule,
  'prefer-parallel-awaits': preferParallelAwaitsRule,
  'no-concurrent-shared-mutation': noConcurrentSharedMutationRule,
  'no-leaky-race-timeout': noLeakyRaceTimeoutRule,
};
