import { noShellInterpolationRule } from './no-shell-interpolation';
import { requirePathContainmentRule } from './require-path-containment';

/** Every rule this plugin exposes, keyed by its (unprefixed) rule id. */
export const rules = {
  'no-shell-interpolation': noShellInterpolationRule,
  // Available but omitted from `recommended` (high false-positive; opt-in).
  'require-path-containment': requirePathContainmentRule,
};
