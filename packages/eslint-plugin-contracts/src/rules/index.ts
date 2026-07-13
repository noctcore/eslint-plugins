import { envVarSchemaParityRule } from './env-var-schema-parity';
import { moneyMustBeDecimalRule } from './money-must-be-decimal';
import { noDirectProcessEnvRule } from './no-direct-process-env';
import { noErrorStringifyRule } from './no-error-stringify';
import { requireErrorCauseRule } from './require-error-cause';
import { requireRegisteredKeysRule } from './require-registered-keys';
import { requireSchemaParseAtBoundaryRule } from './require-schema-parse-at-boundary';
import { restrictThrowToTaxonomyRule } from './restrict-throw-to-taxonomy';
import { wireMessageNamingRule } from './wire-message-naming';
import { zodSchemaNamingRule } from './zod-schema-naming';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'zod-schema-naming': zodSchemaNamingRule,
  'wire-message-naming': wireMessageNamingRule,
  'no-error-stringify': noErrorStringifyRule,
  'no-direct-process-env': noDirectProcessEnvRule,
  'money-must-be-decimal': moneyMustBeDecimalRule,
  'require-error-cause': requireErrorCauseRule,
  'restrict-throw-to-taxonomy': restrictThrowToTaxonomyRule,
  'require-registered-keys': requireRegisteredKeysRule,
  'env-var-schema-parity': envVarSchemaParityRule,
  'require-schema-parse-at-boundary': requireSchemaParseAtBoundaryRule,
};
