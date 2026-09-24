/**
 * The `llms.txt` section that lists deprecated rules. It lives apart from
 * rules-index.ts, which reads the generated catalog and Astro's env, so the
 * site's own tests can render it from a fixture.
 */
export interface DeprecatedRuleLike {
  readonly id: string;
  readonly url: string;
  readonly deprecated: boolean;
  readonly replacedBy: readonly string[];
}

/** `## Deprecated rules` with one line per deprecated rule, or nothing when there are none. */
export function deprecatedRulesSection(rules: readonly DeprecatedRuleLike[]): string[] {
  const deprecated = rules.filter((rule) => rule.deprecated);
  if (deprecated.length === 0) return [];
  const urls = new Map(rules.map((rule) => [rule.id, rule.url]));
  const link = (id: string) => (urls.has(id) ? `[${id}](${urls.get(id)})` : id);
  return [
    '## Deprecated rules',
    '',
    ...deprecated.map((rule) => {
      const note = rule.replacedBy.length > 0 ? `use ${rule.replacedBy.map(link).join(' or ')} instead` : 'no replacement';
      return `- [${rule.id}](${rule.url}): deprecated, ${note}`;
    }),
    '',
  ];
}
