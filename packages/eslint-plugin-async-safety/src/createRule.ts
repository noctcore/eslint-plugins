import { makeCreateRule } from '@noctcore/eslint-utils';

/** RuleCreator for this plugin; docs URLs resolve to the docs site under `rules/async-safety/`. */
export const createRule = makeCreateRule('async-safety');
