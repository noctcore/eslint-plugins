import { authCookieFlagsRule } from './auth-cookie-flags';
import { bcryptRoundsMinRule } from './bcrypt-rounds-min';
import { noShellInterpolationRule } from './no-shell-interpolation';
import { noTimingUnsafeCompareRule } from './no-timing-unsafe-compare';
import { noUserControlledFetchUrlRule } from './no-user-controlled-fetch-url';
import { noUserControlledRedirectRule } from './no-user-controlled-redirect';
import { presignedPostRequiresPolicyRule } from './presigned-post-requires-policy';
import { requirePathContainmentRule } from './require-path-containment';
import { requireSanitizedHtmlRule } from './require-sanitized-html';
import { serverActionThroughClientRule } from './server-action-through-client';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  // Available but omitted from `recommended` (a rule entering it is a major in 1.x, and it matches cookies by name; opt-in).
  'auth-cookie-flags': authCookieFlagsRule,
  // Available but omitted from `recommended` (a rule entering it is a major in 1.x; opt-in).
  'bcrypt-rounds-min': bcryptRoundsMinRule,
  'no-shell-interpolation': noShellInterpolationRule,
  'no-timing-unsafe-compare': noTimingUnsafeCompareRule,
  'no-user-controlled-fetch-url': noUserControlledFetchUrlRule,
  'no-user-controlled-redirect': noUserControlledRedirectRule,
  'presigned-post-requires-policy': presignedPostRequiresPolicyRule,
  // Available but omitted from `recommended` (high false-positive; opt-in).
  'require-path-containment': requirePathContainmentRule,
  // Available but omitted from `recommended` (trusted-HTML producers are per-project; opt-in).
  'require-sanitized-html': requireSanitizedHtmlRule,
  // Available but omitted from `recommended` (needs per-project `actionClients`; opt-in).
  'server-action-through-client': serverActionThroughClientRule,
};
