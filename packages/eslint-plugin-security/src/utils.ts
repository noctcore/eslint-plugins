import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/*
 * Layout-independent AST helpers shared by this package's rules. Kept
 * dependency-free on purpose, and copied rather than imported from a sibling
 * plugin: each package carries only the helpers it needs so it survives being
 * published on its own.
 */

/**
 * Dotted source text of a call's callee when it is a plain identifier or a chain
 * of member accesses (`fetch`, `undici.request`, `client.http.get`). Returns
 * `null` for computed access, `this`, calls, or any other shape, so callers
 * match conservatively against the returned string only.
 */
export function calleeText(callee: TSESTree.Node): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (callee.type === AST_NODE_TYPES.MemberExpression && !callee.computed) {
    const object = calleeText(callee.object);
    if (object === null || callee.property.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    return `${object}.${callee.property.name}`;
  }
  return null;
}

/** Drops all whitespace so configured source text matches however the code is wrapped. */
export function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

/**
 * Peels wrappers that do not change a value: `as`, `satisfies`, `!`, `<T>x` and
 * `await`. `await` is included because a sanitizer or signer that returns a
 * promise yields the same value once awaited.
 */
export function unwrapExpression(node: TSESTree.Expression): TSESTree.Expression {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.AwaitExpression
  ) {
    current = current.type === AST_NODE_TYPES.AwaitExpression ? current.argument : current.expression;
  }
  return current;
}

/**
 * The initializer of the `const NAME = <expr>` this identifier refers to, when
 * it is declared exactly once in this file. Anything else (a parameter, a `let`,
 * an import, a destructured binding) returns `undefined`: its value is runtime.
 */
export function constInitOf(
  node: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression | undefined {
  let scope: TSESLint.Scope.Scope | null = sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) {
      const def = variable.defs.at(0);
      if (
        variable.defs.length !== 1 ||
        def === undefined ||
        def.type !== 'Variable' ||
        def.parent.kind !== 'const' ||
        def.node.id.type !== AST_NODE_TYPES.Identifier ||
        def.node.init === null
      ) {
        return undefined;
      }
      return def.node.init;
    }
    scope = scope.upper;
  }
  return undefined;
}

/**
 * A source-text vocabulary from options: plain entries match an expression's
 * text, and an entry ending in `()` matches any call to that callee, whatever
 * its arguments (`getWebhookSecret()`, `renderMarkdown()`).
 */
export interface SourceVocabulary {
  readonly texts: ReadonlySet<string>;
  readonly callees: ReadonlySet<string>;
}

export function toVocabulary(entries: readonly string[]): SourceVocabulary {
  const texts = new Set<string>();
  const callees = new Set<string>();
  for (const entry of entries) {
    const text = squash(entry);
    if (text.endsWith('()')) {
      callees.add(text.slice(0, -2));
    } else {
      texts.add(text);
    }
  }
  return { texts, callees };
}

/** Whether an expression is named by a {@link SourceVocabulary}. */
export function matchesVocabulary(
  node: TSESTree.Expression,
  vocabulary: SourceVocabulary,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  if (vocabulary.texts.has(squash(sourceCode.getText(node)))) {
    return true;
  }
  return (
    node.type === AST_NODE_TYPES.CallExpression &&
    vocabulary.callees.has(squash(sourceCode.getText(node.callee)))
  );
}
