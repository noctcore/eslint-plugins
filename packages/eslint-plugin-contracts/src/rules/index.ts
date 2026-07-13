import { moneyMustBeDecimalRule } from './money-must-be-decimal';
import { noDirectProcessEnvRule } from './no-direct-process-env';
import { noErrorStringifyRule } from './no-error-stringify';
import { wireMessageNamingRule } from './wire-message-naming';
import { zodSchemaNamingRule } from './zod-schema-naming';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'zod-schema-naming': zodSchemaNamingRule,
  'wire-message-naming': wireMessageNamingRule,
  'no-error-stringify': noErrorStringifyRule,
  'no-direct-process-env': noDirectProcessEnvRule,
  'money-must-be-decimal': moneyMustBeDecimalRule,
};
