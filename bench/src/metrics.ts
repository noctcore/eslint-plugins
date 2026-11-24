/**
 * Turns case outcomes into the four counts and the three rates: detection
 * (true-positive rate), false alarms (false-positive rate) and Youden's J,
 * detection minus false alarms. J is 1 for a rule that catches every
 * vulnerable case and stays silent on every safe twin, 0 for one that is no
 * better than reporting at random, and negative for one that fires more on
 * the safe code than on the vulnerable code.
 */
import type { CaseResult, Outcome } from './score';

export interface Counts {
  readonly tp: number;
  readonly fn: number;
  readonly fp: number;
  readonly tn: number;
}

export interface Score extends Counts {
  /** TP / (TP + FN), or null with no positives. */
  readonly detection: number | null;
  /** FP / (FP + TN), or null with no negatives. */
  readonly falseAlarm: number | null;
  /** detection - falseAlarm, or null when either is null. */
  readonly j: number | null;
}

export function countOutcomes(results: readonly { readonly outcome: Outcome }[]): Counts {
  const counts = { tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const result of results) {
    counts[result.outcome.toLowerCase() as keyof typeof counts]++;
  }
  return counts;
}

/** Rounds to four decimals so the committed baseline does not churn on float noise. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function scoreOf(results: readonly { readonly outcome: Outcome }[]): Score {
  const counts = countOutcomes(results);
  const positives = counts.tp + counts.fn;
  const negatives = counts.fp + counts.tn;
  const detection = positives === 0 ? null : round(counts.tp / positives);
  const falseAlarm = negatives === 0 ? null : round(counts.fp / negatives);
  const j = detection === null || falseAlarm === null ? null : round(detection - falseAlarm);
  return { ...counts, detection, falseAlarm, j };
}

/** Groups results by a key, sorted by key, and scores each group. */
export function scoreBy(
  results: readonly CaseResult[],
  key: (result: CaseResult) => string,
): Map<string, Score> {
  const groups = new Map<string, CaseResult[]>();
  for (const result of results) {
    const k = key(result);
    groups.set(k, [...(groups.get(k) ?? []), result]);
  }
  return new Map([...groups.keys()].sort().map((k) => [k, scoreOf(groups.get(k) ?? [])]));
}

/** A rate as a whole percentage, `-` when there is nothing to measure. */
export function percent(value: number | null): string {
  return value === null ? '-' : `${Math.round(value * 100)}%`;
}

/** J as a signed whole percentage: `+6%`, `-20%`, `0%`. */
export function signedPercent(value: number | null): string {
  if (value === null) return '-';
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}
