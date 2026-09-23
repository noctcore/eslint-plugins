import { noLlmOutputToSinkRule } from './no-llm-output-to-sink';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'no-llm-output-to-sink': noLlmOutputToSinkRule,
};
