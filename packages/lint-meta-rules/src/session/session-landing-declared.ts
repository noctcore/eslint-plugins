import type { IMetaRule, IViolation } from '@noctcore/harness';

import {
  callsMethod,
  scopedSources,
  type SessionSourceScopeOptions,
  toPosix,
  withHint,
} from './scan';

/** One file that opens a door into a session, and where it leaves the caller. */
export interface SessionDoor {
  /** Repo-relative path of the file. */
  readonly file: string;
  /** One of the keys of `landings`. */
  readonly landing: string;
  /** Why this landing is right for this door. Prose, read by whoever adds the next door. Must not be empty. */
  readonly because: string;
}

/**
 * Options for {@link createSessionLandingDeclaredRule}.
 *
 * Ported from Settly, which hardcoded the two door calls, its six doors and the
 * three landings (`login-result`, which must return `Promise<ILoginResult>`,
 * `reissue` and `staff-only`). All of them are options; with no `doorCalls` the
 * rule is inert.
 */
export interface SessionLandingDeclaredOptions extends SessionSourceScopeOptions {
  /** Rule id, for running more than one instance. Default `session-landing-declared`. */
  readonly id?: string;
  /**
   * The methods whose call opens a door into a session (the mint, and the gate
   * in front of it), each matched as `.<name>(`. Empty (the default) = inert.
   */
  readonly doorCalls?: readonly string[];
  /** Every door, declared. A file that calls a door method and is not here is reported. */
  readonly doors?: readonly SessionDoor[];
  /**
   * The landings a door may declare, each mapped to the text a door with that
   * landing must contain (the return type that carries the principal kind to the
   * client, say), or `null` when the landing demands nothing of the source. A
   * door whose landing is not a key here is reported. Default: none.
   */
  readonly landings?: Readonly<Record<string, string | null>>;
  /** Appended to every message: a pointer to the project's own docs. */
  readonly hint?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'session-landing-declared';

/**
 * Every file that opens a door into a session declares where it leaves the
 * caller, and a door that must hand the client the principal kind does.
 *
 * With two shells behind one sign-in, the client can only send an account to
 * the right one if the response that ends the sign-in says which kind it is. A
 * second door that finishes a sign-in from a different service can forget to,
 * and nothing fails: the account signs in and lands in the wrong shell.
 *
 * The check is completeness first: a file that calls a door method and is not
 * in `doors` fails the build until someone classifies it, which is what keeps
 * the list an enumeration rather than a docblock nobody updates. Then each
 * door's landing is checked against `landings`, and a declared door that no
 * longer exists (or that `sourceGlobs` do not reach) is reported so the list
 * cannot go stale.
 */
export function createSessionLandingDeclaredRule(
  options: SessionLandingDeclaredOptions = {},
): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const doorCalls = (options.doorCalls ?? []).filter((name) => name !== '');
  const doors = (options.doors ?? []).map((door) => ({ ...door, file: toPosix(door.file) }));
  const landings = options.landings ?? {};
  const landingNames = Object.keys(landings);
  const callList = doorCalls.join(' or ');

  return {
    id,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'Every file that opens a door into a session must declare where it leaves the caller, and a door whose landing demands a return shape (the one that carries the principal kind to the client) must have it.',
    run(ctx) {
      if (doorCalls.length === 0) return [];
      const violations: IViolation[] = [];
      const report = (file: string, message: string): void => {
        violations.push({ file, rule: id, message: withHint(message, options.hint) });
      };

      // The declarations themselves: a landing the rule does not know, or a
      // door with no reason, is a list nobody can review.
      for (const door of doors) {
        if (!Object.hasOwn(landings, door.landing)) {
          report(
            door.file,
            `\`doors\` declares this file with landing \`${door.landing}\`, which is not one of the configured landings (${landingNames.join(', ') || 'none'}).`,
          );
        }
        if (door.because.trim() === '') {
          report(door.file, '`doors` declares this file with an empty `because`. Write down why its landing is the right one.');
        }
      }

      const { matched, sources } = scopedSources(ctx, options);
      for (const { file, text } of sources) {
        if (!doorCalls.some((name) => callsMethod(text, name))) continue;

        const declared = doors.find((door) => door.file === file);
        if (declared === undefined) {
          report(
            file,
            `This file opens a door into a session (${callList}) and does not declare where it leaves the caller. Add it to \`doors\` with one of the landings (${landingNames.join(', ') || 'none'}) and a \`because\`: can this door end a sign-in for an account the client must route by kind? Then declare the landing that returns the kind. Does the caller already hold a session? Or can such an account provably never reach it? Say so in \`because\`.`,
          );
          continue;
        }

        const required = landings[declared.landing];
        if (typeof required === 'string' && required !== '' && !text.includes(required)) {
          report(
            file,
            `This door is declared \`${declared.landing}\` but its source never contains \`${required}\`, so the sign-in it completes hands the client nothing to route the account by. Return it, or reclassify the door in \`doors\` with the proof that it cannot end such a sign-in.`,
          );
        }
      }

      for (const door of doors) {
        if (!matched.has(door.file)) {
          report(
            door.file,
            '`doors` names a file that no longer exists, or that `sourceGlobs` do not reach. Remove the entry, or point it at the file the door moved to.',
          );
        }
      }
      return violations;
    },
  };
}
