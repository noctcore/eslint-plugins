import type { IMetaRule, IViolation } from '@noctcore/harness';

import {
  callArguments,
  mentionsIdentifier,
  pathSet,
  scopedSources,
  type SessionSourceScopeOptions,
  withHint,
} from './scan';

/**
 * Options for {@link createSessionEpochCapturedRule}.
 *
 * Ported from Settly, which hardcoded the seam (`beginOrEstablish`), the field
 * (`epoch`) and the seam's own file. With no `call` the rule is inert.
 */
export interface SessionEpochCapturedOptions extends SessionSourceScopeOptions {
  /** Rule id, for running more than one instance. Default `session-epoch-captured`. */
  readonly id?: string;
  /**
   * The post-credential seam every sign-in passes through on its way to a
   * session, matched as `.<call>(`. Unset or empty = inert.
   */
  readonly call?: string;
  /** The argument every call must mention: the epoch captured before the credential was read. Default `epoch`. */
  readonly field?: string;
  /**
   * Repo-relative files skipped outright: the seam's own home, which defines
   * the method and may call itself without a captured value. Default: none.
   */
  readonly exempt?: readonly string[];
  /** How the epoch is captured (e.g. `sessions.readEpoch(userId)`), quoted in the message. Optional. */
  readonly captureCall?: string;
  /** Appended to every message: a pointer to the project's own docs. */
  readonly hint?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'session-epoch-captured';
const DEFAULT_FIELD = 'epoch';

/**
 * Every call into the sign-in seam passes the session epoch it captured before
 * reading the credential.
 *
 * A revoke-all bumps a per-user epoch and a mint refuses to write a session
 * under a stale one. Captured inside the mint, the fence covers the store write
 * and nothing else: the whole credential check (a password hash verify, an
 * OAuth token exchange) is a window in which a sign-in that already read the
 * revoked state still mints a surviving session. So each entry point captures
 * the epoch first and hands it to the seam, and this rule fails any call whose
 * arguments never mention it.
 */
export function createSessionEpochCapturedRule(options: SessionEpochCapturedOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const call = options.call ?? '';
  const field = options.field ?? DEFAULT_FIELD;
  const exempt = pathSet(options.exempt);

  return {
    id,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every call into the sign-in seam must pass the session epoch captured before the credential was read, or a revocation landing during the credential check loses the race.',
    run(ctx) {
      if (call === '') return [];
      const violations: IViolation[] = [];
      for (const { file, text } of scopedSources(ctx, options).sources) {
        if (exempt.has(file)) continue;
        for (const args of callArguments(text, call)) {
          if (mentionsIdentifier(args, field)) continue;
          violations.push({
            file,
            rule: id,
            message: withHint(
              `${call}() must be passed \`${field}\`, captured${
                options.captureCall === undefined ? '' : ` with ${options.captureCall}`
              } BEFORE this flow reads the credential it authenticates on. Without it the epoch fence starts at the session write, so a revocation landing during the credential check loses the race.`,
              options.hint,
            ),
          });
        }
      }
      return violations;
    },
  };
}
