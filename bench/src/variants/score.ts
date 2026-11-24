/**
 * Lints every variant the way its case is linted and classifies it with the
 * same rules: a vulnerable variant's labels are positives, a safe variant is
 * a negative for each rule its own category measures and runs. Rules of other
 * categories are not charged on variants; the corpus run already covers them.
 */
import { Linter } from 'eslint';

import type { Category } from '../corpus';
import { categoryConfig, classifyCase, runsIn, type CaseResult, type LoadedPlugin } from '../score';
import type { Variant } from './generate';

export interface VariantResult extends CaseResult {
  readonly transform: string;
  /** The id of the corpus result this variant rewrites: the same id without `~<transform>`. */
  readonly baseId: string;
}

export function scoreVariants(
  categories: readonly Category[],
  plugins: ReadonlyMap<string, LoadedPlugin>,
  cwd: string,
  variants: readonly Variant[],
): VariantResult[] {
  const linter = new Linter({ cwd });
  const byId = new Map(categories.map((c) => [c.id, c]));
  const configs = new Map<string, { config: Linter.Config[]; measured: string[]; negative: string[] }>();
  const results: VariantResult[] = [];
  const fatal: string[] = [];
  for (const variant of variants) {
    const category = byId.get(`${variant.plugin}/${variant.meta.category}`);
    const plugin = plugins.get(variant.plugin);
    if (category === undefined || plugin === undefined) throw new Error(`no category or plugin for ${variant.file}`);
    let setup = configs.get(category.id);
    if (setup === undefined) {
      const measured = [
        ...new Set(categories.filter((c) => c.plugin === category.plugin).flatMap((c) => c.config.rules)),
      ].sort();
      setup = {
        config: categoryConfig(category, plugin),
        measured,
        negative: category.config.rules.filter((rule) => runsIn(rule, category, plugin)),
      };
      configs.set(category.id, setup);
    }
    const messages = linter.verify(variant.lintSource, setup.config, { filename: variant.lintPath });
    const broken = messages.filter((m) => m.fatal === true || m.ruleId === null);
    if (broken.length > 0) {
      fatal.push(...broken.map((m) => `${variant.file}:${m.line}: ${m.message}`));
      continue;
    }
    for (const result of classifyCase(variant, category, messages, setup.measured, setup.negative).results) {
      results.push({
        ...result,
        transform: variant.transform,
        baseId: `${variant.baseFile}${result.id.slice(variant.file.length)}`,
      });
    }
  }
  if (fatal.length > 0) throw new Error(`Variants did not lint cleanly:\n${fatal.map((f) => `  - ${f}`).join('\n')}`);
  return results;
}
