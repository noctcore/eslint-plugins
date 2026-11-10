import { effectFiredMutationMustBindCallbacksRule } from './effect-fired-mutation-must-bind-callbacks';
import { mutationRequiresErrorHandlingRule } from './mutation-requires-error-handling';
import { trpcInvalidateWithPathKeyRule } from './trpc-invalidate-with-path-key';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'effect-fired-mutation-must-bind-callbacks': effectFiredMutationMustBindCallbacksRule,
  'mutation-requires-error-handling': mutationRequiresErrorHandlingRule,
  'trpc-invalidate-with-path-key': trpcInvalidateWithPathKeyRule,
};
