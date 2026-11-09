import type { TSESTree } from '@typescript-eslint/utils';

/*
 * Layout-independent helpers for this package's async-safety rules. The shared
 * RuleTester is NOT type-aware, so every rule here is high-precision syntactic;
 * these helpers are the AST plumbing that makes that possible.
 */

// Callee paths and glob matching are shared with the other plugins through
// @noctcore/eslint-utils; re-exported under the names these rules already use.
export {
  calleePath as calleeText,
  globToRegExp,
  matchesAnyGlob,
} from '@noctcore/eslint-utils';

/** Depth-first walk over a node's descendants (skips the `parent` back-edge). */
export function walk(node: TSESTree.Node, visit: (node: TSESTree.Node) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) {
          walk(child, visit);
        }
      }
    } else if (isNode(value)) {
      walk(value, visit);
    }
  }
}

function isNode(value: unknown): value is TSESTree.Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
