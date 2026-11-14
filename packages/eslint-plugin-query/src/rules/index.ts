import { effectFiredMutationMustBindCallbacksRule } from './effect-fired-mutation-must-bind-callbacks';
import { mutationRequiresErrorHandlingRule } from './mutation-requires-error-handling';
import { prefixQueryKeyMustUseSetQueriesDataRule } from './prefix-query-key-must-use-set-queries-data';
import { queryFnMustNotSwallowErrorRule } from './query-fn-must-not-swallow-error';
import { queryKeyMustBeConstantRule } from './query-key-must-be-constant';
import { trpcInvalidateWithPathKeyRule } from './trpc-invalidate-with-path-key';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'effect-fired-mutation-must-bind-callbacks': effectFiredMutationMustBindCallbacksRule,
  'mutation-requires-error-handling': mutationRequiresErrorHandlingRule,
  'prefix-query-key-must-use-set-queries-data': prefixQueryKeyMustUseSetQueriesDataRule,
  'query-fn-must-not-swallow-error': queryFnMustNotSwallowErrorRule,
  'query-key-must-be-constant': queryKeyMustBeConstantRule,
  'trpc-invalidate-with-path-key': trpcInvalidateWithPathKeyRule,
};
