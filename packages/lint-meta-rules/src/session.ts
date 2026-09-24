/**
 * `@noctcore/lint-meta-rules/session`: fences around the seam that mints a
 * session.
 *
 * A separate entry point because every rule here is meaningless without the
 * project's own facts (the method that mints, the gate in front of it, the
 * files allowed to call it, the landings a sign-in can end in), so none of them
 * belongs in `RULE_FACTORIES` or `createAllRules()`: with no options each is
 * inert. They load nothing beyond the harness contract.
 */
export {
  createSessionEpochCapturedRule,
  type SessionEpochCapturedOptions,
} from './session/session-epoch-captured';
export {
  createSessionKindStampedRule,
  type SessionKindStampedOptions,
} from './session/session-kind-stamped';
export {
  createSessionLandingDeclaredRule,
  type SessionDoor,
  type SessionLandingDeclaredOptions,
} from './session/session-landing-declared';
export {
  createSessionMintCallersRule,
  type SessionMintCallersOptions,
} from './session/session-mint-callers';
export { callArguments, type SessionSourceScopeOptions } from './session/scan';
