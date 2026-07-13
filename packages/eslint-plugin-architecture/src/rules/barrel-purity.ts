import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { getBasename, isIgnoredPath } from '../utils';

const RULE_NAME = 'barrel-purity';

export interface BarrelPurityOptions {
  readonly allow?: readonly string[];
}

type RuleOptions = [BarrelPurityOptions];
type MessageIds = 'impureBarrel';

/*
 * A barrel (`index.ts` / `index.tsx`) exists to re-export a folder's public
 * surface — nothing else. Anything besides a re-export (a local declaration, a
 * side-effect import, a default-exported value, or plain logic) turns the barrel
 * into a module with behavior, so a consumer that imports the folder silently
 * pulls that behavior in. This rule flags every top-level statement that is not
 * a pure re-export. No fix — moving logic out of a barrel is a human decision
 * about where it should live.
 *
 * Allowed in a pure barrel:
 *   - `export { a } from './a'`      (named re-export from another module)
 *   - `export * from './a'`          (star re-export)
 *   - `export * as ns from './a'`    (namespace re-export)
 *   - `export { a, b as c }`         (specifier-only re-export of imported bindings)
 *   - `export type { T } from './t'` / `export type { T }`
 *   - `import { a } from './a'`      (import that feeds a re-export)
 *   - `export default Foo`           (re-export of an imported/local binding by name)
 *
 * Flagged as impure:
 *   - `export const x = …` / `export function f() {}` / `export class C {}`
 *   - `export type T = …` / `export interface I {}` / `export enum E {}` (local decls)
 *   - `export default () => {}` / `export default { … }` (a value, not a re-export)
 *   - `import './styles.css'`        (side-effect import)
 *   - any non-import/export statement (`const x = …`, a call expression, `if` …)
 */
const DEFAULT_ALLOW: readonly string[] = [];

const BARREL_BASENAME = /^index\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allow: { type: 'array', items: { type: 'string' }, uniqueItems: true },
  },
};

/**
 * The impurity label for a top-level statement, or `null` when the statement is
 * a pure re-export (and therefore allowed in a barrel).
 */
function impurityOf(stmt: TSESTree.ProgramStatement): string | null {
  switch (stmt.type) {
    case AST_NODE_TYPES.ImportDeclaration:
      // An import that carries bindings feeds a re-export; a specifier-less
      // import (`import './x'`) runs the module purely for its side effects.
      return stmt.specifiers.length === 0 ? 'a side-effect import' : null;
    case AST_NODE_TYPES.ExportAllDeclaration:
      return null;
    case AST_NODE_TYPES.ExportNamedDeclaration:
      if (stmt.source !== null) {
        return null; // `export { … } from './x'` — a re-export.
      }
      if (stmt.declaration === null) {
        return null; // `export { a, b }` — specifier-only re-export.
      }
      return 'a local declaration';
    case AST_NODE_TYPES.ExportDefaultDeclaration:
      // `export default Foo` re-exports a binding; anything else is a value.
      return stmt.declaration.type === AST_NODE_TYPES.Identifier
        ? null
        : 'a default-exported value';
    case AST_NODE_TYPES.ExpressionStatement:
      return 'a side-effect statement';
    default:
      return 'non-re-export code';
  }
}

export const barrelPurityRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A barrel (`index.ts` / `index.tsx`) must contain only re-exports — never local declarations, side effects, or default-exported values.',
    },
    schema: [optionSchema],
    messages: {
      impureBarrel:
        'A barrel must contain only re-exports; found {{kind}}. Move it into a sibling module and re-export it from here.',
    },
  },
  defaultOptions: [{ allow: [] }],
  create(context, [options]) {
    const allow = options.allow ?? DEFAULT_ALLOW;
    const filename = context.filename;

    if (!BARREL_BASENAME.test(getBasename(filename)) || isIgnoredPath(filename, allow)) {
      return {};
    }

    return {
      Program(node): void {
        for (const stmt of node.body) {
          const kind = impurityOf(stmt);
          if (kind !== null) {
            context.report({ node: stmt, messageId: 'impureBarrel', data: { kind } });
          }
        }
      },
    };
  },
});
