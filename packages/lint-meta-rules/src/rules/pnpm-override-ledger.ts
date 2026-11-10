import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';

import { workspaceMap } from './pnpm-workspace-yaml';
import { asRecord } from './shared';
import {
  compareVersions,
  parseRange,
  parseVersion,
  satisfies,
  splitOverrideKey,
  targetLowerBound,
} from './version-range';

/** Options for {@link createPnpmOverrideLedgerRule}. */
export interface PnpmOverrideLedgerOptions {
  /** The ledger, a JSON object keyed by the exact override key. Default `'overrides.ledger.json'`. */
  readonly ledgerFile?: string;
  /** The pnpm lockfile read for resolved versions. Default `'pnpm-lock.yaml'`. */
  readonly lockfile?: string;
  /** Today, for the `reviewBy` check. Default the current date (compared as a UTC calendar day). */
  readonly now?: () => Date;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const RULE_ID = 'pnpm-override-ledger';
const MANIFEST_FILE = 'package.json';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;

type LedgerKind = 'security' | 'unify';

interface LedgerEntry {
  readonly kind: LedgerKind;
  readonly firstPatched?: string;
  readonly reviewBy: string;
}

function violation(file: string, message: string): IViolation {
  return { file, rule: RULE_ID, message };
}

function parseJson(text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Every declared override: the root package.json `pnpm.overrides` and the
 * pnpm-workspace.yaml `overrides:` mapping (pnpm 10 reads both). Null when
 * neither exists.
 */
function readOverrides(ctx: IMetaCtx): Map<string, string> | null {
  const fromManifest = asRecord(asRecord(asRecord(parseJson(ctx.read(MANIFEST_FILE)))?.['pnpm'])?.['overrides']);
  const workspace = ctx.read(WORKSPACE_FILE);
  const fromWorkspace = workspace === null ? null : workspaceMap(workspace, 'overrides');
  if (fromManifest === null && fromWorkspace === null) return null;
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(fromManifest ?? {})) {
    if (typeof value === 'string') out.set(key, value);
  }
  for (const [key, value] of fromWorkspace ?? []) out.set(key, value);
  return out;
}

/** The lines of one top-level section of a lockfile. */
function lockfileSection(text: string, section: string): string[] {
  const lines: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (/^\S/u.test(line)) {
      inside = line.startsWith(`${section}:`);
      continue;
    }
    if (inside) lines.push(line);
  }
  return lines;
}

/**
 * The versions the lockfile resolves per package name, read from its
 * `packages:` section (keys `name@version:`, quoted when scoped). The
 * `snapshots:` section repeats them with peer suffixes and is skipped.
 */
function lockfileResolutions(text: string): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const line of lockfileSection(text, 'packages')) {
    const match = /^ {2}(?:'([^']+)'|([^\s:'][^:]*)):$/u.exec(line);
    const key = match?.[1] ?? match?.[2];
    if (key === undefined) continue;
    const { name, selector: version } = splitOverrideKey(key);
    if (version === null) continue;
    byName.set(name, [...(byName.get(name) ?? []), version]);
  }
  return byName;
}

/** The lockfile's own `overrides:` block, as `key: value` pairs. */
function lockfileOverrides(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lockfileSection(text, 'overrides')) {
    const match = /^ {2}(?:'([^']+)'|([^\s:'][^:]*)):\s*(.+)$/u.exec(line);
    const key = match?.[1] ?? match?.[2];
    if (key !== undefined && match?.[3] !== undefined) {
      out.set(key, match[3].trim().replace(/^'(.*)'$/u, '$1'));
    }
  }
  return out;
}

function parseEntry(raw: unknown): { entry: LedgerEntry } | { error: string } {
  const record = asRecord(raw);
  if (record === null) return { error: 'the entry is not an object' };
  const kind = record['kind'];
  if (kind !== 'security' && kind !== 'unify') return { error: '`kind` must be "security" or "unify"' };
  const reason = record['reason'];
  if (typeof reason !== 'string' || reason.trim() === '') return { error: '`reason` must be a non-empty string' };
  const reviewBy = record['reviewBy'];
  if (typeof reviewBy !== 'string') return { error: '`reviewBy` is missing. An undated entry is not an exception' };
  const advisories = record['advisories'];
  if (advisories !== undefined && !(Array.isArray(advisories) && advisories.every((item) => typeof item === 'string'))) {
    return { error: '`advisories` must be an array of advisory ids' };
  }
  const firstPatched = record['firstPatched'];
  if (firstPatched !== undefined && typeof firstPatched !== 'string') {
    return { error: '`firstPatched` must be a version string' };
  }
  return { entry: { kind, reviewBy, ...(firstPatched === undefined ? {} : { firstPatched }) } };
}

/**
 * Every pnpm override must say why it exists and when to look at it again.
 *
 * An override is a security control written as a bare version string: no
 * advisory, no first patched version, no expiry, and from the outside a stale
 * one is indistinguishable from a live one. The ledger (keyed by the exact
 * override key) carries the missing facts, and this rule makes it load bearing.
 * It reports:
 *
 * 1. an override with no ledger entry, and a ledger entry with no override;
 * 2. a `reviewBy` that is missing, not a real `yyyy-MM-dd` date, or past (green
 *    for the whole of its UTC day, red from the next);
 * 3. a `security` entry whose target can only resolve below its own
 *    `firstPatched`: the override fires on every install and still lands on a
 *    vulnerable version;
 * 4. a lockfile that still resolves a version inside the selector (the override
 *    was never applied);
 * 5. a selector-less pin that resolves to more than one version (a `unify` pin
 *    that is not unifying), and a lockfile `overrides:` block that disagrees
 *    with what is declared.
 *
 * Dormant with no overrides and no ledger.
 */
export function createPnpmOverrideLedgerRule(options: PnpmOverrideLedgerOptions = {}): IMetaRule {
  const ledgerFile = options.ledgerFile ?? 'overrides.ledger.json';
  const lockfile = options.lockfile ?? 'pnpm-lock.yaml';
  const now = options.now ?? (() => new Date());
  const ciCritical = options.ciCritical ?? true;

  function reviewViolations(key: string, reviewBy: string, today: string): IViolation[] {
    if (!ISO_DATE.test(reviewBy)) {
      return [violation(ledgerFile, `\`${key}\` has \`reviewBy: "${reviewBy}"\`, which is not a yyyy-MM-dd date. An undated entry is not an exception.`)];
    }
    // A day its month does not have (2026-02-30) parses, rolled into the next month.
    const due = new Date(`${reviewBy}T00:00:00Z`);
    if (Number.isNaN(due.getTime()) || due.toISOString().slice(0, 10) !== reviewBy) {
      return [violation(ledgerFile, `\`${key}\` has \`reviewBy: "${reviewBy}"\`, which is not a real date.`)];
    }
    if (today <= reviewBy) return [];
    return [
      violation(
        ledgerFile,
        `\`${key}\` was due for review on ${reviewBy}. Re-check it against open advisories, then delete the override or move the date forward with a reason.`,
      ),
    ];
  }

  function securityViolations(key: string, entry: LedgerEntry, target: string): IViolation[] {
    if (entry.firstPatched === undefined) {
      return [
        violation(
          ledgerFile,
          `\`${key}\` is a security override with no \`firstPatched\`. Record the advisory's first patched version so the pin can be checked against it.`,
        ),
      ];
    }
    const firstPatched = parseVersion(entry.firstPatched);
    if (firstPatched === null) {
      return [violation(ledgerFile, `\`${key}\` has \`firstPatched: "${entry.firstPatched}"\`, which is not a plain x.y.z version.`)];
    }
    const lowest = targetLowerBound(target);
    if (lowest === null) {
      return [
        violation(
          ledgerFile,
          `\`${key}\` overrides to "${target}", which this rule cannot read as ^x.y.z, ~x.y.z or x.y.z. Write a plain target so the pin can be compared with \`firstPatched\`.`,
        ),
      ];
    }
    if (compareVersions(lowest, firstPatched) >= 0) return [];
    return [
      violation(
        ledgerFile,
        `\`${key}\` overrides to "${target}", whose lowest resolvable version is below its own \`firstPatched\` (${entry.firstPatched}). The override fires on every install and still lands on a vulnerable version.`,
      ),
    ];
  }

  function resolutionViolations(key: string, target: string, resolutions: Map<string, string[]>): IViolation[] {
    const { name, selector } = splitOverrideKey(key);
    const resolved = resolutions.get(name) ?? [];
    if (selector === null) {
      if (resolved.length <= 1) return [];
      return [
        violation(
          lockfile,
          `\`${key}\` pins one version ("${target}") but ${lockfile} resolves ${String(resolved.length)}: ${resolved.join(', ')}. The pin is not unifying the tree.`,
        ),
      ];
    }
    const range = parseRange(selector);
    if (range === null) {
      return [
        violation(
          MANIFEST_FILE,
          `\`${key}\` has a selector this rule cannot read ("${selector}"). Use \`<x\`, \`<=x\`, \`>=a <b\` or \`=x\` so the lockfile can be checked against it.`,
        ),
      ];
    }
    const stillInRange = resolved.filter((version) => {
      const parsed = parseVersion(version);
      return parsed !== null && satisfies(parsed, range);
    });
    if (stillInRange.length === 0) return [];
    return [
      violation(
        lockfile,
        `\`${key}\` should have moved every copy past "${selector}", but ${lockfile} still resolves ${name}@${stillInRange.join(', ')}. The override is declared and not honoured.`,
      ),
    ];
  }

  return {
    id: RULE_ID,
    category: 'supply-chain',
    ciCritical,
    description: `Every pnpm override needs an entry in ${ledgerFile} with a reason and a reviewBy that has not passed, a security pin must target its own firstPatched or higher, and the lockfile must honour the override.`,
    run(ctx) {
      const overrides = readOverrides(ctx);
      const ledgerText = ctx.read(ledgerFile);
      if (overrides === null && ledgerText === null) return [];
      if (ledgerText === null) {
        if (overrides === null || overrides.size === 0) return [];
        return [
          violation(
            ledgerFile,
            `The repo declares pnpm overrides but ${ledgerFile} does not exist. Every override needs a reason, an advisory and a review date.`,
          ),
        ];
      }
      const ledger = asRecord(parseJson(ledgerText));
      if (ledger === null) return [violation(ledgerFile, `${ledgerFile} is not a JSON object keyed by override key.`)];

      const declared = overrides ?? new Map<string, string>();
      const lockText = ctx.read(lockfile) ?? '';
      const resolutions = lockfileResolutions(lockText);
      const locked = lockfileOverrides(lockText);
      const today = now().toISOString().slice(0, 10);
      const violations: IViolation[] = [];

      for (const key of Object.keys(ledger)) {
        if (!declared.has(key)) {
          violations.push(
            violation(
              ledgerFile,
              `\`${key}\` has a ledger entry but no matching override. Delete the entry, or restore the override if it was dropped by accident.`,
            ),
          );
        }
      }

      for (const [key, target] of declared) {
        const raw = Object.hasOwn(ledger, key) ? ledger[key] : undefined;
        if (raw === undefined) {
          violations.push(
            violation(
              ledgerFile,
              `\`${key}\` is overridden to "${target}" with no ledger entry. Add one with \`kind\`, \`reason\` and \`reviewBy\` (plus \`advisories\` and \`firstPatched\` for a security pin).`,
            ),
          );
          continue;
        }
        const parsed = parseEntry(raw);
        if ('error' in parsed) {
          violations.push(violation(ledgerFile, `\`${key}\`: ${parsed.error}.`));
          continue;
        }
        violations.push(...reviewViolations(key, parsed.entry.reviewBy, today));
        if (parsed.entry.kind === 'security') violations.push(...securityViolations(key, parsed.entry, target));
        violations.push(...resolutionViolations(key, target, resolutions));
        const lockedTarget = locked.get(key);
        if (locked.size > 0 && lockedTarget !== target) {
          violations.push(
            violation(
              lockfile,
              `\`${key}\` is overridden to "${target}" but ${lockedTarget === undefined ? 'is absent from' : `reads "${lockedTarget}" in`} the lockfile's overrides block. Run the install so the lockfile records the override that is actually declared.`,
            ),
          );
        }
      }
      return violations;
    },
  };
}
