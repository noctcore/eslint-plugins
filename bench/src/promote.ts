/**
 * Promotes a variant to committed corpus cases: `bun run bench --promote
 * <file>~<transform>` writes the whole pair under that transform as a new pair
 * `<pair>-<transform>` next to the original, so the shape a rule missed stays
 * measured even if the generator changes. A twin the transform does not apply
 * to is copied as it is, so the new pair still has both kinds.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Category } from './corpus';
import { splitVariantFile, type Variant } from './variants/generate';

export interface Promotion {
  /** Paths under the corpus root, as `security/ssrf/x-via-helper.vuln.js.case`. */
  readonly written: readonly string[];
  /** Twins written unchanged because the transform does not apply to them. */
  readonly unchanged: readonly string[];
}

function retitle(source: string, pair: string, nextPair: string, transform: string): string {
  const [header = '', ...rest] = source.split('\n');
  const next = header
    .replace(`pair=${pair}`, `pair=${nextPair}`)
    .replace(/title="([^"]*)"/u, (_, title: string) => `title="${title}, rewritten by ${transform}"`);
  return [next, ...rest].join('\n');
}

export function promoteVariant(
  corpusRoot: string,
  categories: readonly Category[],
  variants: readonly Variant[],
  id: string,
): Promotion {
  const split = splitVariantFile(id);
  if (split === null) throw new Error(`"${id}" is not a variant id; expected <file>~<transform>, as the report lists them`);
  const { baseFile, transform } = split;
  const category = categories.find((c) => c.cases.some((x) => x.file === baseFile));
  const base = category?.cases.find((x) => x.file === baseFile);
  if (category === undefined || base === undefined) throw new Error(`no corpus case ${baseFile}`);
  const pairCases = category.cases.filter((c) => c.meta.pair === base.meta.pair);
  const pairVariants = pairCases.map((c) => variants.find((v) => v.baseFile === c.file && v.transform === transform));
  if (pairVariants.every((v) => v === undefined)) throw new Error(`the transform "${transform}" does not apply to the pair ${base.meta.pair}`);
  const nextPair = `${base.meta.pair}-${transform}`;
  const planned = pairCases.map((c, i) => {
    const name = c.file.slice(c.file.lastIndexOf('/') + 1).replace(`${c.meta.pair}.`, `${nextPair}.`);
    const file = `${dirname(c.file)}/${name}`;
    const variant = pairVariants[i];
    return { file, source: retitle(variant?.source ?? c.source, c.meta.pair, nextPair, transform), changed: variant !== undefined };
  });
  const taken = planned.filter((p) => existsSync(join(corpusRoot, p.file)));
  if (taken.length > 0) throw new Error(`already promoted: ${taken.map((p) => p.file).join(', ')}`);
  for (const p of planned) writeFileSync(join(corpusRoot, p.file), p.source);
  return { written: planned.map((p) => p.file), unchanged: planned.filter((p) => !p.changed).map((p) => p.file) };
}
