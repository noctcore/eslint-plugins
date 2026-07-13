import path from 'node:path';

import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { toPosix } from '../utils';

const RULE_NAME = 'max-import-depth';

export interface MaxImportDepthOptions {
  readonly max?: number;
  readonly alias?: Readonly<Record<string, string>>;
}

type RuleOptions = [MaxImportDepthOptions];
type MessageIds = 'tooDeep';

/*
 * A relative import that climbs more than `max` parent levels (`../../../../…`)
 * is a smell: the module is reaching so far up the tree that a path alias would
 * be clearer and survive a move. This flags any specifier whose leading `..`
 * run exceeds `max` (default 3 — so `../../../x` is fine and `../../../../x`
 * reports).
 *
 * `alias` maps a directory-anchor segment to an alias prefix, e.g.
 * `{ src: '@' }`. When a too-deep import resolves through a `/<anchor>/`
 * segment, the rule autofixes it to `<prefix>/<rest-after-anchor>`
 * (`../../../../shared/log` from `src/a/b/c/d.ts` -> `@/shared/log`). With no
 * matching alias the violation is reported without a fix — there is nothing
 * safe to rewrite it to.
 */
const DEFAULT_MAX = 3;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    max: { type: 'integer', minimum: 0 },
    alias: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
  },
};

/** Leading `..` count of a relative specifier (`../../x` -> 2); 0 for non-relative. */
function climbDepth(source: string): number {
  if (!source.startsWith('.')) {
    return 0;
  }
  let depth = 0;
  for (const segment of source.split('/')) {
    if (segment === '..') {
      depth += 1;
    } else if (segment === '.') {
      continue;
    } else {
      break;
    }
  }
  return depth;
}

/**
 * Rewrite a too-deep relative import to an alias by resolving it against the
 * importing file and anchoring on the first (deepest) `/<anchor>/` segment, or
 * `null` when no alias anchor is on the resolved path.
 */
function aliasRewrite(
  source: string,
  currentFile: string,
  alias: Readonly<Record<string, string>>,
): string | null {
  const resolved = toPosix(path.resolve(path.dirname(currentFile), source));
  for (const [anchor, prefix] of Object.entries(alias)) {
    const marker = `/${anchor}/`;
    const idx = resolved.lastIndexOf(marker);
    if (idx === -1) {
      continue;
    }
    const rest = resolved.slice(idx + marker.length);
    if (rest.length === 0) {
      continue;
    }
    return `${prefix}/${rest}`;
  }
  return null;
}

export const maxImportDepthRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    fixable: 'code',
    docs: {
      description:
        'A relative import may not climb more than `max` parent levels (default 3). Autofixed to a path alias when one is configured.',
    },
    schema: [optionSchema],
    messages: {
      tooDeep:
        'Relative import `{{source}}` climbs {{depth}} levels — over the limit of {{max}}. Use a path alias instead of reaching this far up the tree.',
    },
  },
  defaultOptions: [{ max: DEFAULT_MAX, alias: {} }],
  create(context, [options]) {
    const max = options.max ?? DEFAULT_MAX;
    const alias = options.alias ?? {};
    const filename = context.filename;

    function check(sourceNode: TSESTree.Literal | null | undefined): void {
      if (
        sourceNode === null ||
        sourceNode === undefined ||
        typeof sourceNode.value !== 'string'
      ) {
        return;
      }
      const source = sourceNode.value;
      const depth = climbDepth(source);
      if (depth <= max) {
        return;
      }
      const rewrite = aliasRewrite(source, filename, alias);
      context.report({
        node: sourceNode,
        messageId: 'tooDeep',
        data: { source, depth, max },
        fix:
          rewrite === null
            ? undefined
            : (fixer): TSESLint.RuleFix => {
                const quote = sourceNode.raw.charAt(0);
                return fixer.replaceText(sourceNode, `${quote}${rewrite}${quote}`);
              },
      });
    }

    function literalSource(
      node: TSESTree.Node | null | undefined,
    ): TSESTree.Literal | null {
      return node !== null && node !== undefined && node.type === AST_NODE_TYPES.Literal
        ? node
        : null;
    }

    return {
      ImportDeclaration(node): void {
        check(node.source);
      },
      ImportExpression(node): void {
        check(literalSource(node.source));
      },
      ExportNamedDeclaration(node): void {
        check(literalSource(node.source));
      },
      ExportAllDeclaration(node): void {
        check(literalSource(node.source));
      },
    };
  },
});
