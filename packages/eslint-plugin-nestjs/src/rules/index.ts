import { jobNameMustBeConstantRule } from './job-name-must-be-constant';
import { queueAddRequiresDedupKeyRule } from './queue-add-requires-dedup-key';
import { scheduleStatesTimeZoneRule } from './schedule-states-time-zone';
import { workerMustListenFailedRule } from './worker-must-listen-failed';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'job-name-must-be-constant': jobNameMustBeConstantRule,
  'queue-add-requires-dedup-key': queueAddRequiresDedupKeyRule,
  'schedule-states-time-zone': scheduleStatesTimeZoneRule,
  'worker-must-listen-failed': workerMustListenFailedRule,
};
