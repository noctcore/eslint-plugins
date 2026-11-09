import { createRule } from '../createRule';

const RULE_NAME = 'no-pr-reference-comments';

type MessageIds = 'prReferenceComment';

interface PrPattern {
  readonly pattern: RegExp;
  readonly label: string;
}

const PR_PATTERNS: readonly PrPattern[] = [
  {
    pattern: /https?:\/\/github\.com\/[^\s)]+\/(?:pull|issues)\/\d+/iu,
    label: 'GitHub PR/issue URL',
  },
  {
    pattern: /\b(?:see|closes?|fixes|fixed|addresses|resolves?|refs?)\s+#\d+/iu,
    label: 'issue/PR reference',
  },
  {
    pattern: /\bPRs?\s+#?\d+/iu,
    label: 'PR number',
  },
  {
    // A bare `#<n>`: two or more digits without a leading zero, not a percentage
    // or a hex colour. `step #2` and `#000 at 50%` are prose, not references.
    pattern: /(?:^|[\s(])#[1-9]\d+(?![\w%])/u,
    label: 'issue/PR number',
  },
];

export interface NoPrReferenceCommentsOptions {
  /** Extra regex sources for tracker keys, such as `[A-Z][A-Z0-9]+-\\d+` for Jira or Linear. */
  readonly trackerPatterns?: readonly string[];
}

type RuleOptions = [NoPrReferenceCommentsOptions];

export const noPrReferenceCommentsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow PR/issue references in comments. They belong in commit messages and PR descriptions, where they do not rot when the repo moves, the issue tracker migrates, or the numbering changes.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          trackerPatterns: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Extra tracker-key patterns to report (regex sources), matched at word boundaries with the u flag.',
          },
        },
      },
    ],
    messages: {
      prReferenceComment:
        'Comment contains {{label}} ({{snippet}}). Move it to the commit message or PR description. The git log is the canonical place for repo-history references.',
    },
  },
  defaultOptions: [{ trackerPatterns: [] }],
  create(context, [options]) {
    const patterns: readonly PrPattern[] = [
      ...PR_PATTERNS,
      ...(options.trackerPatterns ?? []).map((source) => ({
        pattern: new RegExp(`\\b(?:${source})\\b`, 'u'),
        label: 'tracker reference',
      })),
    ];
    return {
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value;
          if (text.trim() === '') {
            continue;
          }
          for (const { pattern, label } of patterns) {
            const match = pattern.exec(text);
            if (match === null) {
              continue;
            }
            const matched = match[0].trim();
            const snippet = matched.length > 40 ? `${matched.slice(0, 40)}...` : matched;
            context.report({
              loc: comment.loc,
              messageId: 'prReferenceComment',
              data: { label, snippet },
            });
            break;
          }
        }
      },
    };
  },
});
