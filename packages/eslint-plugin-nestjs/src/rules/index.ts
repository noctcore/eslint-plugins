import { addRequiresDedupeRule } from './add-requires-dedupe';
import { jobNameMustBeConstantRule } from './job-name-must-be-constant';
import { jobOptionsMustSetAttemptsRule } from './job-options-must-set-attempts';
import { noDirectRateLimitRule } from './no-direct-rate-limit';
import { noDynamicJobNameRule } from './no-dynamic-job-name';
import { noRawBullmqQueueAddRule } from './no-raw-bullmq-queue-add';
import { queueAddRequiresDedupKeyRule } from './queue-add-requires-dedup-key';
import { queueOptionsMustSetRetentionRule } from './queue-options-must-set-retention';
import { queueRegistrationThroughDefineQueueRule } from './queue-registration-through-define-queue';
import { redisClientFromFactoryRule } from './redis-client-from-factory';
import { scheduleStatesTimeZoneRule } from './schedule-states-time-zone';
import { workerConcurrencyRule } from './worker-concurrency';
import { workerExtendsJobHostRule } from './worker-extends-job-host';
import { workerMustImplementCloseRule } from './worker-must-implement-close';
import { workerMustListenFailedRule } from './worker-must-listen-failed';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'add-requires-dedupe': addRequiresDedupeRule,
  'job-name-must-be-constant': jobNameMustBeConstantRule,
  'job-options-must-set-attempts': jobOptionsMustSetAttemptsRule,
  'no-direct-rate-limit': noDirectRateLimitRule,
  'no-dynamic-job-name': noDynamicJobNameRule,
  'no-raw-bullmq-queue-add': noRawBullmqQueueAddRule,
  'queue-add-requires-dedup-key': queueAddRequiresDedupKeyRule,
  'queue-options-must-set-retention': queueOptionsMustSetRetentionRule,
  'queue-registration-through-define-queue': queueRegistrationThroughDefineQueueRule,
  'redis-client-from-factory': redisClientFromFactoryRule,
  'schedule-states-time-zone': scheduleStatesTimeZoneRule,
  'worker-concurrency': workerConcurrencyRule,
  'worker-extends-job-host': workerExtendsJobHostRule,
  'worker-must-implement-close': workerMustImplementCloseRule,
  'worker-must-listen-failed': workerMustListenFailedRule,
};
