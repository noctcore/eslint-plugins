import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/** A module a value came from, and the member path inside it (`fs` + `['promises', 'readFile']`). */
export interface ModuleMember {
  readonly module: string;
  readonly path: readonly string[];
}

const MAX_DEPTH = 12;

/** Strips the TS-only wrappers and optional chains that do not change a value. */
export function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.TSTypeAssertion ||
    current.type === AST_NODE_TYPES.ChainExpression
  ) {
    current = current.expression;
  }
  return current;
}

/** The name of `.name` / `['name']`, or null for a computed or private key. */
export function staticPropertyName(node: TSESTree.MemberExpression): string | null {
  if (!node.computed) {
    return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : null;
  }
  return node.property.type === AST_NODE_TYPES.Literal && typeof node.property.value === 'string'
    ? node.property.value
    : null;
}

/** The key of `{ a }` / `{ 'a': x }`, or null for a computed key. */
export function propertyKeyName(property: TSESTree.Property): string | null {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  return property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string'
    ? property.key.value
    : null;
}

/**
 * `node:fs`, `fs/promises` and Electron's `original-fs` all name the same
 * functions, so one method table covers every spelling.
 */
function normalizeModule(specifier: string): ModuleMember {
  const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  if (bare === 'fs/promises') return { module: 'fs', path: ['promises'] };
  if (bare === 'original-fs') return { module: 'fs', path: [] };
  if (bare === 'path/posix' || bare === 'path/win32') return { module: 'path', path: [] };
  return { module: bare, path: [] };
}

function requireSpecifier(node: TSESTree.Node): string | null {
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'require' &&
    node.arguments.length === 1
  ) {
    const [argument] = node.arguments;
    if (argument?.type === AST_NODE_TYPES.Literal && typeof argument.value === 'string') {
      return argument.value;
    }
  }
  return null;
}

function withPath(member: ModuleMember | null, extra: readonly string[]): ModuleMember | null {
  return member === null ? null : { module: member.module, path: [...member.path, ...extra] };
}

/** `const { promises: { readFile } } = require('fs')`: the key path to `target` inside the pattern. */
function patternKeys(pattern: TSESTree.Node, target: TSESTree.Identifier): string[] | null {
  if (pattern === target) return [];
  if (pattern.type === AST_NODE_TYPES.AssignmentPattern) return patternKeys(pattern.left, target);
  if (pattern.type !== AST_NODE_TYPES.ObjectPattern) return null;
  for (const property of pattern.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    const inner = patternKeys(property.value, target);
    if (inner !== null) {
      const key = propertyKeyName(property);
      return key === null ? null : [key, ...inner];
    }
  }
  return null;
}

/**
 * The module member an expression is bound to, through `import` (default,
 * namespace or named), `require`, `const` aliases, destructuring and member
 * access: `fsp.readFile` after `import fsp from 'fs/promises'` is
 * `fs` + `['promises', 'readFile']`. Null for anything it cannot see through.
 */
export function moduleMemberOf(
  raw: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
  depth = 0,
): ModuleMember | null {
  if (depth > MAX_DEPTH) return null;
  const node = unwrap(raw);
  if (node.type === AST_NODE_TYPES.MemberExpression) {
    const name = staticPropertyName(node);
    return name === null ? null : withPath(moduleMemberOf(node.object, sourceCode, depth + 1), [name]);
  }
  if (node.type === AST_NODE_TYPES.CallExpression) {
    const specifier = requireSpecifier(node);
    return specifier === null ? null : normalizeModule(specifier);
  }
  if (node.type !== AST_NODE_TYPES.Identifier) return null;
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  if (variable == null || variable.defs.length !== 1 || def === undefined) return null;
  if (def.type === 'ImportBinding') {
    if (def.parent.type !== AST_NODE_TYPES.ImportDeclaration) return null;
    const base = normalizeModule(def.parent.source.value);
    if (def.node.type !== AST_NODE_TYPES.ImportSpecifier) return base;
    const imported =
      def.node.imported.type === AST_NODE_TYPES.Identifier
        ? def.node.imported.name
        : String(def.node.imported.value);
    return withPath(base, [imported]);
  }
  if (def.type !== 'Variable' || def.parent.kind !== 'const' || def.node.init === null) return null;
  const init = moduleMemberOf(def.node.init, sourceCode, depth + 1);
  if (init === null) return null;
  const keys = patternKeys(def.node.id, def.name);
  return keys === null ? null : withPath(init, keys);
}
