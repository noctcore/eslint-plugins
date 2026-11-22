import { auditPiiDeclaredRule } from './audit-pii-declared';
import { noErrorDetailLossRule } from './no-error-detail-loss';
import { noSensitiveFieldsInLogsRule } from './no-sensitive-fields-in-logs';
import { requireEventFieldRule } from './require-event-field';
import { structuredLogArgumentsRule } from './structured-log-arguments';
import { typedEventNamesRule } from './typed-event-names';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'structured-log-arguments': structuredLogArgumentsRule,
  'no-sensitive-fields-in-logs': noSensitiveFieldsInLogsRule,
  'no-error-detail-loss': noErrorDetailLossRule,
  'audit-pii-declared': auditPiiDeclaredRule,
  'require-event-field': requireEventFieldRule,
  'typed-event-names': typedEventNamesRule,
};
