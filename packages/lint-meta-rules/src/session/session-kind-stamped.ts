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
 * Options for {@link createSessionKindStampedRule}.
 *
 * Ported from Settly, which hardcoded the mint (`establishSession`), the field
 * (`kind`) and the one staff-only exemption. With no `mintCall` the rule is inert.
 */
export interface SessionKindStampedOptions extends SessionSourceScopeOptions {
  /** Rule id, for running more than one instance. Default `session-kind-stamped`. */
  readonly id?: string;
  /** The method whose call mints a session, matched as `.<mintCall>(`. Unset or empty = inert. */
  readonly mintCall?: string;
  /** The session field every mint must stamp. Default `kind`. */
  readonly field?: string;
  /**
   * Repo-relative files whose mints may stamp nothing because they provably can
   * never mint for a principal that needs the field (a self-signup that only
   * ever creates the default kind). Keep it short and write the proof next to
   * each entry. Default: none.
   */
  readonly allowUnstamped?: readonly string[];
  /** An example of the stamp, quoted in the message (e.g. a conditional spread). Optional. */
  readonly stampExample?: string;
  /** Appended to every message: a pointer to the project's own docs. */
  readonly hint?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'session-kind-stamped';
const DEFAULT_FIELD = 'kind';

/**
 * Every session mint stamps the principal's kind onto the session it writes.
 *
 * When the request pipeline reads the kind from the SESSION rather than the
 * database, a session minted without it reads as whatever the reader defaults
 * to. For a fence between two kinds of account that is a silent promotion of
 * one into the other, and every gate stays green because nothing looks.
 *
 * The check, in order of precision:
 *
 * 1. A call whose arguments contain an object LITERAL must mention the field in
 *    that literal. Each literal is checked on its own, so one stamped mint does
 *    not excuse an unstamped one in the same file.
 * 2. A call with no literal (options built elsewhere) falls back to the file:
 *    the file must mention the field somewhere. Coarser, but no silent hole.
 * 3. Otherwise the file must be on `allowUnstamped`.
 *
 * Residual gap, stated rather than hidden: a file that stamps the field on one
 * delegated mint and forgets it on a second delegated mint passes clause 2.
 */
export function createSessionKindStampedRule(options: SessionKindStampedOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const mintCall = options.mintCall ?? '';
  const field = options.field ?? DEFAULT_FIELD;
  const allowUnstamped = pathSet(options.allowUnstamped);

  return {
    id,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every call that mints a session must stamp the principal kind onto it, or sit in an allowlisted, provably single-kind flow; a session read without the kind falls back to a default and can silently promote one kind of account into another.',
    run(ctx) {
      if (mintCall === '') return [];
      const violations: IViolation[] = [];
      for (const { file, text } of scopedSources(ctx, options).sources) {
        if (allowUnstamped.has(file)) continue;
        const calls = callArguments(text, mintCall);
        if (calls.length === 0) continue;
        const fileStamps = mentionsIdentifier(text, field);

        for (const args of calls) {
          // Clause 1: a hand-written options literal must mention the field itself.
          // Clause 2: delegated options fall back to the file-level check.
          const stamped = args.includes('{') ? mentionsIdentifier(args, field) : fileStamps;
          if (stamped) continue;
          violations.push({
            file,
            rule: id,
            message: withHint(
              `${mintCall}() must stamp \`${field}\` onto the session it mints${
                options.stampExample === undefined ? '' : `: add \`${options.stampExample}\` to the options`
              }. A session read without \`${field}\` falls back to the reader's default, so an unstamped mint can silently promote one kind of account into another. If this flow provably can never mint for an account that needs the field, add the file to \`allowUnstamped\` with the proof.`,
              options.hint,
            ),
          });
        }
      }
      return violations;
    },
  };
}
