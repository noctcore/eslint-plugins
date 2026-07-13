import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

/*
 * Layout-independent helpers shared by this package's async-safety rules. Kept
 * dependency-free on purpose: the shared RuleTester is NOT type-aware, so every
 * rule here is high-precision syntactic — these helpers are the AST plumbing that
 * makes that possible.
 */

/**
 * Dotted source text of a call's callee when it is a plain identifier or a chain
 * of member accesses (`fetch`, `undici.request`, `client.http.get`). Returns
 * `null` for computed access, `this`, calls, or any other shape — callers match
 * conservatively against the returned string only.
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

/**
 * Compile a minimal glob to an anchored RegExp. Supports a double-star (any run,
 * including `/`), a single star (any run except `/`), `?` (one non-`/`), and a
 * leading double-star-slash that also matches zero leading segments. Inlined
 * because micromatch does not resolve in the de-projected/published layout.
 */
export function globToRegExp(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        i += 1;
        if (glob[i + 1] === '/') {
          i += 1;
          source += '(?:.*/)?'; // `**/` — any number of leading segments, or none.
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(char as string)) {
      source += `\\${char}`;
    } else {
      source += char;
    }
  }
  return new RegExp(`^${source}$`);
}

/** True when the (forward-slash-normalized) filename matches any of the globs. */
export function matchesAnyGlob(filename: string, globs: readonly string[]): boolean {
  if (globs.length === 0) {
    return false;
  }
  const normalized = filename.split('\\').join('/');
  return globs.some((glob) => globToRegExp(glob).test(normalized));
}

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
