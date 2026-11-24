/**
 * Renaming: every local binding, or every parameter, gets an opaque new name.
 * A rule that keys on `req`, `url` or `safe*` names, rather than on what the
 * code does, flips here.
 */
import type { TSESTree } from '@typescript-eslint/utils';

import { declaredVariables, isExported, isRequireBinding, parentOf, type Parsed, type Variable } from './ast';
import { renameOccurrence, type Edit } from './edits';
import type { Transform, TransformContext } from './transform';

/** Names that carry meaning outside the binding: the classic JSX runtime needs `React` in scope. */
const KEEP = new Set(['React']);

function renameVariable(p: Parsed, variable: Variable, name: string): Edit[] {
  const occurrences = new Set<TSESTree.Node>([...variable.identifiers, ...variable.references.map((r) => r.identifier)]);
  return [...occurrences].flatMap((identifier) => renameOccurrence(p, identifier, name));
}

function isLocalBinding(p: Parsed, variable: Variable): boolean {
  if (KEEP.has(variable.name) || variable.defs.length === 0) return false;
  if (isExported(p, variable) || isRequireBinding(variable)) return false;
  return variable.defs.every(
    (d) => d.type === 'Variable' || d.type === 'FunctionName' || d.type === 'ClassName' || d.type === 'CatchClause',
  );
}

function isPlainParameter(p: Parsed, variable: Variable): boolean {
  if (KEEP.has(variable.name) || variable.defs.length === 0) return false;
  return variable.defs.every((d) => {
    if (d.type !== 'Parameter') return false;
    // A constructor parameter property (`private readonly http: HttpService`) is also a class member.
    for (let cur = parentOf(p, d.name); cur !== null && cur !== d.node; cur = parentOf(p, cur)) {
      if (cur.type === 'TSParameterProperty') return false;
    }
    return true;
  });
}

function renameAll(context: TransformContext, keep: (p: Parsed, v: Variable) => boolean, stem: string): Edit[] {
  const { p, names } = context;
  // A class declaration binds its name twice (around and inside the class); both get one new name.
  const given = new Map<TSESTree.Node, string>();
  const edits: Edit[] = [];
  for (const variable of declaredVariables(p).filter((v) => keep(p, v))) {
    const shared = variable.identifiers.map((i) => given.get(i)).find((n) => n !== undefined);
    const name = shared ?? names.numbered(stem, variable.name);
    for (const identifier of variable.identifiers) given.set(identifier, name);
    edits.push(...renameVariable(p, variable, name));
  }
  return edits;
}

export const renameLocals: Transform = {
  name: 'rename-locals',
  summary: 'every local variable, function and class gets an opaque name (`local1`, ...)',
  plan: (context) => renameAll(context, isLocalBinding, 'local'),
};

export const renameParams: Transform = {
  name: 'rename-params',
  summary: 'every function parameter gets an opaque name (`param1`, ...), `req` and `ctx` included',
  plan: (context) => renameAll(context, isPlainParameter, 'param'),
};
