import { noErrorDetailLossRule } from './no-error-detail-loss';
import { noSensitiveFieldsInLogsRule } from './no-sensitive-fields-in-logs';
import { structuredLogArgumentsRule } from './structured-log-arguments';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'structured-log-arguments': structuredLogArgumentsRule,
  'no-sensitive-fields-in-logs': noSensitiveFieldsInLogsRule,
  'no-error-detail-loss': noErrorDetailLossRule,
};
