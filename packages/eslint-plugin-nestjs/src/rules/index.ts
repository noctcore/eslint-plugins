import { jobNameMustBeConstantRule } from './job-name-must-be-constant';
import { jobOptionsMustSetAttemptsRule } from './job-options-must-set-attempts';
import { queueAddRequiresDedupKeyRule } from './queue-add-requires-dedup-key';
import { queueOptionsMustSetRetentionRule } from './queue-options-must-set-retention';
import { scheduleStatesTimeZoneRule } from './schedule-states-time-zone';
import { workerConcurrencyRule } from './worker-concurrency';
import { workerMustImplementCloseRule } from './worker-must-implement-close';
import { workerMustListenFailedRule } from './worker-must-listen-failed';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'job-name-must-be-constant': jobNameMustBeConstantRule,
  'job-options-must-set-attempts': jobOptionsMustSetAttemptsRule,
  'queue-add-requires-dedup-key': queueAddRequiresDedupKeyRule,
  'queue-options-must-set-retention': queueOptionsMustSetRetentionRule,
  'schedule-states-time-zone': scheduleStatesTimeZoneRule,
  'worker-concurrency': workerConcurrencyRule,
  'worker-must-implement-close': workerMustImplementCloseRule,
  'worker-must-listen-failed': workerMustListenFailedRule,
};
