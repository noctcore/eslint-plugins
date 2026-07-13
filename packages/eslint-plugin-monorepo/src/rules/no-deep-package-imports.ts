import type { TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-deep-package-imports';

export interface NoDeepPackageImportsOptions {
  /**
   * npm scopes whose packages must be consumed through their barrel only, e.g.
   * `['@acme']`. REQUIRED — there is no default scope, so with no scopes the
   * rule matches nothing and never fires spuriously in a repo that has not
   * opted in.
   */
  readonly scopes: readonly string[];
  /**
   * Escape hatch: subpaths (the part AFTER `@scope/pkg/`) that are permitted
   * even though they reach past the barrel, e.g. `['package.json',
   * 'jsx-runtime']`. Matched exactly against the remainder of the specifier.
   */
  readonly allowedSubpaths?: readonly string[];
}

type RuleOptions = [NoDeepPackageImportsOptions];
type MessageIds = 'deepImport';

/*
 * A workspace package is consumed only through its `@scope/<pkg>` barrel. A deep
 * subpath (`@scope/<pkg>/internal/thing`) reaches past the barrel into
 * internals, defeating the package's documented public surface. If a deep entry
 * is genuinely intended, add an explicit `exports` subpath to that package (or
 * list it under `allowedSubpaths`) rather than relaxing this rule.
 *
 * De-projected from nightcore's `no-deep-package-imports`, which hardcoded the
 * `@nightcore` scope: the scope(s) are now a REQUIRED `scopes` option so the
 * rule is inert until a consumer opts in with their own scope.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  required: ['scopes'],
  properties: {
    scopes: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
    allowedSubpaths: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
    },
  },
};

function literalString(node: TSESTree.Node | null | undefined): string | null {
  return node && node.type === 'Literal' && typeof node.value === 'string'
    ? node.value
    : null;
}

/**
 * When `source` is a deep import into one of the configured `scopes` (past the
 * package barrel, and not an allowed subpath), the barrel it should route
 * through — otherwise null.
 */
function deepImportBarrel(
  source: string,
  scopes: readonly string[],
  allowedSubpaths: readonly string[],
): string | null {
  for (const scope of scopes) {
    const prefix = `${scope}/`;
    if (!source.startsWith(prefix)) {
      continue;
    }
    const rest = source.slice(prefix.length); // `<pkg>` or `<pkg>/<subpath...>`
    const slash = rest.indexOf('/');
    if (slash === -1) {
      return null; // `@scope/pkg` — the barrel itself, allowed.
    }
    const pkg = rest.slice(0, slash);
    const subpath = rest.slice(slash + 1);
    if (pkg === '' || subpath === '') {
      return null; // `@scope//x` or trailing `@scope/pkg/` — not a deep entry.
    }
    if (allowedSubpaths.includes(subpath)) {
      return null; // Explicitly sanctioned deep entry.
    }
    return `${scope}/${pkg}`;
  }
  return null;
}

export const noDeepPackageImportsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Workspace packages in the configured `scopes` must be consumed through their package barrel only — never via a deep subpath into package internals.',
    },
    schema: [optionSchema],
    messages: {
      deepImport:
        "Deep import `{{source}}` reaches into a package's internals. Import the barrel `{{barrel}}` instead; if a deep entry is truly intended, add an explicit `exports` subpath to that package.",
    },
  },
  defaultOptions: [{ scopes: [], allowedSubpaths: [] }],
  create(context, [options]) {
    const scopes = options.scopes;
    const allowedSubpaths = options.allowedSubpaths ?? [];

    // No configured scopes → the rule matches nothing. Skip the AST walk.
    if (scopes.length === 0) {
      return {};
    }

    function check(node: TSESTree.Node, source: string | null): void {
      if (source === null) {
        return;
      }
      const barrel = deepImportBarrel(source, scopes, allowedSubpaths);
      if (barrel !== null) {
        context.report({
          node,
          messageId: 'deepImport',
          data: { source, barrel },
        });
      }
    }

    return {
      ImportDeclaration(node): void {
        check(node, literalString(node.source));
      },
      ExportNamedDeclaration(node): void {
        check(node, literalString(node.source));
      },
      ExportAllDeclaration(node): void {
        check(node, literalString(node.source));
      },
      ImportExpression(node): void {
        check(node, literalString(node.source));
      },
    };
  },
});
