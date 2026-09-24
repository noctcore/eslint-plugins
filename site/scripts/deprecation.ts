/**
 * The contract a deprecated rule has to meet, as a list of broken promises.
 * `deprecation.test.ts` runs it over the real inventory, where it must come
 * back empty, and over a fixture, where it must catch each break.
 *
 * - A deprecated rule is in no `recommended` preset, not even at `off`: a
 *   preset is what a consumer spreads without reading, and it must not hand
 *   them a rule that is on its way out.
 * - Every id in `replacedBy` is a rule in the inventory, and not a deprecated one.
 * - The rule's doc carries the generated header with its deprecation sentence,
 *   so the markdown on npm and GitHub says so, not just the site.
 */
import { HEADER_BEGIN, HEADER_END, deprecationSentence } from './readmes';
import type { PackageEntry } from './inventory';

/** `docs` maps `<short>/<rule>` to the doc's markdown. */
export function deprecationProblems(
  inventory: readonly PackageEntry[],
  docs: ReadonlyMap<string, string>,
): string[] {
  const byId = new Map(inventory.flatMap((pkg) => pkg.rules.map((rule) => [rule.id, rule] as const)));
  const problems: string[] = [];
  for (const pkg of inventory) {
    for (const rule of pkg.rules) {
      if (!rule.deprecated) continue;
      if (rule.recommended !== null) {
        problems.push(`${rule.id} is deprecated but its package's recommended preset lists it (${rule.recommended})`);
      }
      for (const id of rule.replacedBy) {
        const replacement = byId.get(id);
        if (!replacement) problems.push(`${rule.id} is replaced by ${id}, which is not a rule in this repo`);
        else if (replacement.deprecated) problems.push(`${rule.id} is replaced by ${id}, which is deprecated too`);
      }
      const doc = docs.get(`${pkg.short}/${rule.name}`) ?? '';
      const header = doc.slice(doc.indexOf(HEADER_BEGIN), doc.indexOf(HEADER_END));
      if (!doc.includes(HEADER_BEGIN) || !header.includes(deprecationSentence(rule))) {
        problems.push(`${rule.id} is deprecated but its doc has no generated deprecation header`);
      }
    }
  }
  return problems;
}
