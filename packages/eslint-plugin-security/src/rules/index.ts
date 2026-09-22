import { noShellInterpolationRule } from './no-shell-interpolation';
import { noUserControlledFetchUrlRule } from './no-user-controlled-fetch-url';
import { noUserControlledRedirectRule } from './no-user-controlled-redirect';
import { requirePathContainmentRule } from './require-path-containment';
import { serverActionThroughClientRule } from './server-action-through-client';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'no-shell-interpolation': noShellInterpolationRule,
  'no-user-controlled-fetch-url': noUserControlledFetchUrlRule,
  'no-user-controlled-redirect': noUserControlledRedirectRule,
  // Available but omitted from `recommended` (high false-positive; opt-in).
  'require-path-containment': requirePathContainmentRule,
  // Available but omitted from `recommended` (needs per-project `actionClients`; opt-in).
  'server-action-through-client': serverActionThroughClientRule,
};
