import type { IMetaRule, IViolation } from '@noctcore/harness';

import {
  callsMethod,
  pathSet,
  scopedSources,
  type SessionSourceScopeOptions,
  withHint,
} from './scan';

/**
 * Options for {@link createSessionMintCallersRule}.
 *
 * Ported from Settly's `establish-session-callers`, which hardcoded the method
 * (`establishSession`), the gate (`beginOrEstablish`) and the five allowlisted
 * files. All three are options here; with no `mintCall` the rule is inert.
 */
export interface SessionMintCallersOptions extends SessionSourceScopeOptions {
  /** Rule id, for running more than one instance. Default `session-mint-callers`. */
  readonly id?: string;
  /**
   * The method whose call mints a session (sets the cookie, writes the store),
   * matched as `.<mintCall>(`. Unset or empty = inert.
   */
  readonly mintCall?: string;
  /**
   * Repo-relative files that may call it: the method's own home, the gate in
   * front of it, and flows with no gate to pass (signup, a re-issue to a caller
   * who already holds a session). Matched exactly, so a same-named file in
   * another directory is not allowed. Default: none.
   */
  readonly allowedCallers?: readonly string[];
  /**
   * The method a new sign-in entry point must route through instead (a second
   * factor challenge, say), named in the message. Optional.
   */
  readonly gateCall?: string;
  /** Appended to every message: a pointer to the project's own docs. */
  readonly hint?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'session-mint-callers';

/**
 * The method that mints a session is callable only from an allowlist of files.
 *
 * A session minted straight from a sign-in entry point skips whatever the gate
 * in front of the mint enforces (a second factor, an epoch capture), and nothing
 * else fails: the new flow signs the user in and every test passes. The mint is
 * the one door into a session, so the rule fences the door by caller.
 */
export function createSessionMintCallersRule(options: SessionMintCallersOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const mintCall = options.mintCall ?? '';
  const allowed = pathSet(options.allowedCallers);
  const gate = options.gateCall;

  return {
    id,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'The method that mints a session may only be called from allowlisted files; a new sign-in entry point must route through the gate in front of it so the gate cannot be bypassed.',
    run(ctx) {
      if (mintCall === '') return [];
      const violations: IViolation[] = [];
      const allowedList = [...allowed].join(', ') || 'none';
      for (const { file, text } of scopedSources(ctx, options).sources) {
        if (allowed.has(file)) continue;
        if (!callsMethod(text, mintCall)) continue;
        violations.push({
          file,
          rule: id,
          message: withHint(
            `${mintCall}() may only be called from the allowlisted files (${allowedList}).${
              gate === undefined
                ? ''
                : ` A sign-in or OAuth entry point must call ${gate}() instead, so the checks it runs before minting are not bypassed.`
            } If this is a genuine mint that passes no gate (a signup, or a re-issue to a caller who already holds a session), add the file to \`allowedCallers\` with a justification.`,
            options.hint,
          ),
        });
      }
      return violations;
    },
  };
}
