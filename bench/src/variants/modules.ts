/**
 * Module rewrites: how a binding arrives (aliased, through a namespace, by
 * `require` or `import`) and whether a builtin carries the `node:` prefix.
 * A rule that recognises `exec` only as a bare named import of
 * `child_process` flips here.
 */
import type { TSESTree } from '@typescript-eslint/utils';

import { parentOf, requiredModule, textOf, variableOf, type Node, type Parsed, type Variable } from './ast';
import { renameOccurrence, replaceNode, replaceRange, type Edit } from './edits';
import type { Transform } from './transform';

/** Node builtins that also exist without the `node:` prefix (prefix-only ones such as `node:test` are left alone). */
const BUILTINS = new Set([
  'assert', 'assert/strict', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'dns/promises', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2',
  'https', 'inspector', 'inspector/promises', 'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks',
  'process', 'punycode', 'querystring', 'readline', 'readline/promises', 'repl', 'stream', 'stream/consumers',
  'stream/promises', 'stream/web', 'string_decoder', 'timers', 'timers/promises', 'tls', 'trace_events', 'tty', 'url',
  'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/** The classic JSX runtime needs `React` under that name. */
const KEEP = new Set(['React']);

function variablesOf(p: Parsed, node: Node): Variable[] {
  return p.scopeManager.getDeclaredVariables(node as never) as Variable[];
}

function referencedByExport(p: Parsed, variable: Variable): boolean {
  return variable.references.some((r) => {
    const parent = parentOf(p, r.identifier);
    return parent?.type === 'ExportSpecifier' || parent?.type === 'ExportDefaultDeclaration';
  });
}

/** Renames every reference, except those inside `skip` (the binding's own declaration, which the caller rewrites). */
function renameReferences(p: Parsed, variable: Variable, text: string, skip?: Node): Edit[] {
  return variable.references
    .filter((r) => skip === undefined || r.identifier.range[0] < skip.range[0] || r.identifier.range[1] > skip.range[1])
    .flatMap((r) => renameOccurrence(p, r.identifier, text));
}

function importedName(specifier: TSESTree.ImportSpecifier): string | null {
  return specifier.imported.type === 'Identifier' ? specifier.imported.name : null;
}

function valueImports(p: Parsed): TSESTree.ImportDeclaration[] {
  return p.ast.body.filter((s): s is TSESTree.ImportDeclaration => s.type === 'ImportDeclaration' && s.importKind !== 'type');
}

/** Every `const x = require('m')` / `const { a } = require('m')` declarator, at any depth. */
function requireDeclarators(p: Parsed): TSESTree.VariableDeclarator[] {
  return p.nodes.filter(
    (n): n is TSESTree.VariableDeclarator => n.type === 'VariableDeclarator' && requiredModule(n.init) !== null && n.init?.type === 'CallExpression',
  );
}

/** A destructuring pattern made only of `{ a }` and `{ a: b }` properties. */
function simplePattern(pattern: TSESTree.ObjectPattern): TSESTree.Property[] | null {
  const props: TSESTree.Property[] = [];
  for (const prop of pattern.properties) {
    if (prop.type !== 'Property' || prop.computed || prop.key.type !== 'Identifier' || prop.value.type !== 'Identifier') return null;
    props.push(prop);
  }
  return props;
}

function aliasPlan(p: Parsed, names: { numbered(base: string, original: string): string }): Edit[] {
  const edits: Edit[] = [];
  for (const declaration of valueImports(p)) {
    for (const specifier of declaration.specifiers) {
      if (KEEP.has(specifier.local.name)) continue;
      const [variable] = variablesOf(p, specifier);
      if (variable === undefined || referencedByExport(p, variable)) continue;
      if (specifier.type === 'ImportSpecifier') {
        const imported = importedName(specifier);
        if (imported === null || imported !== specifier.local.name || specifier.importKind === 'type') continue;
        const alias = names.numbered('imported', imported);
        edits.push(replaceRange(specifier.range, `${imported} as ${alias}`), ...renameReferences(p, variable, alias));
      } else {
        const alias = names.numbered('imported', specifier.local.name);
        edits.push(replaceRange(specifier.local.range, alias), ...renameReferences(p, variable, alias));
      }
    }
  }
  for (const declarator of requireDeclarators(p)) {
    for (const variable of variablesOf(p, declarator)) {
      if (KEEP.has(variable.name) || referencedByExport(p, variable)) continue;
      const identifier = variable.identifiers[0];
      const parent = identifier === undefined ? null : parentOf(p, identifier);
      // `{ exec: run }` already renames; only `{ exec }` and `const cp = ...` are aliased here.
      if (identifier === undefined || (parent?.type === 'Property' && !parent.shorthand)) continue;
      const alias = names.numbered('imported', variable.name);
      edits.push(replaceNode(p, identifier, alias), ...renameReferences(p, variable, alias));
    }
  }
  return edits;
}

export const importAlias: Transform = {
  name: 'import-alias',
  summary: 'imported bindings are aliased: `import { exec as imported1 }`, `const { exec: imported1 } = require(...)`',
  plan: ({ p, names }) => aliasPlan(p, names),
};

/** `node:child_process` to `childProcess`, `@nestjs/common` to `common`. */
function namespaceStem(specifier: string): string {
  const last = specifier.replace(/^node:/u, '').split('/').filter((s) => s !== '' && !s.startsWith('@')).pop() ?? 'mod';
  const camel = last.replace(/[^A-Za-z0-9]+(.)?/gu, (_, c: string | undefined) => (c ?? '').toUpperCase());
  return /^[A-Za-z_$]/u.test(camel) ? camel : `mod${camel}`;
}

function namespacePlan(p: Parsed, names: { fresh(base: string): string }): Edit[] {
  const edits: Edit[] = [];
  for (const declaration of valueImports(p)) {
    const named = declaration.specifiers.filter((s): s is TSESTree.ImportSpecifier => s.type === 'ImportSpecifier');
    if (named.length === 0 || declaration.specifiers.some((s) => s.type === 'ImportNamespaceSpecifier')) continue;
    const variables = named.map((s) => ({ s, v: variablesOf(p, s)[0], imported: importedName(s) }));
    if (variables.some(({ v, imported }) => v === undefined || imported === null || referencedByExport(p, v))) continue;
    const ns = names.fresh(namespaceStem(declaration.source.value));
    const fallback = declaration.specifiers.find((s) => s.type === 'ImportDefaultSpecifier');
    const head = fallback === undefined ? '' : `${fallback.local.name}, `;
    edits.push(replaceRange(declaration.range, `import ${head}* as ${ns} from ${textOf(p, declaration.source)};`));
    for (const { v, imported } of variables) edits.push(...renameReferences(p, v as Variable, `${ns}.${imported}`));
  }
  for (const declarator of requireDeclarators(p)) {
    if (declarator.id.type !== 'ObjectPattern') continue;
    const props = simplePattern(declarator.id);
    if (props === null) continue;
    const pairs = props.map((prop) => ({ key: (prop.key as TSESTree.Identifier).name, v: variableOf(p, prop.value) ?? undefined }));
    if (pairs.some(({ v }) => v === undefined || referencedByExport(p, v))) continue;
    const ns = names.fresh(namespaceStem(requiredModule(declarator.init) ?? 'mod'));
    edits.push(replaceRange(declarator.id.range, ns));
    for (const { key, v } of pairs) edits.push(...renameReferences(p, v as Variable, `${ns}.${key}`, declarator.id));
  }
  return edits;
}

export const importNamespace: Transform = {
  name: 'import-namespace',
  summary: 'named imports go through a namespace: `import * as childProcess`, `const childProcess = require(...)`, then `childProcess.exec(...)`',
  plan: ({ p, names }) => namespacePlan(p, names),
};

function isJs(p: Parsed): boolean {
  return /\.jsx?$/u.test(p.lintPath);
}

function hasExports(p: Parsed): boolean {
  return p.ast.body.some((s) => s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration' || s.type === 'ExportAllDeclaration');
}

function requireText(declaration: TSESTree.ImportDeclaration, source: string): string {
  const parts: string[] = [];
  const named: string[] = [];
  for (const s of declaration.specifiers) {
    if (s.type === 'ImportDefaultSpecifier' || s.type === 'ImportNamespaceSpecifier') {
      parts.push(`const ${s.local.name} = require(${source});`);
    } else {
      const imported = s.imported.type === 'Identifier' ? s.imported.name : JSON.stringify(s.imported.value);
      named.push(imported === s.local.name ? imported : `${imported}: ${s.local.name}`);
    }
  }
  if (named.length > 0) parts.push(`const { ${named.join(', ')} } = require(${source});`);
  return parts.length > 0 ? parts.join(' ') : `require(${source});`;
}

/** ESM to CommonJS, for JavaScript files that export nothing (a module with exports stays ESM). */
function esmToCjsPlan(p: Parsed): Edit[] {
  if (!isJs(p) || hasExports(p)) return [];
  return valueImports(p).map((d) => replaceRange(d.range, requireText(d, textOf(p, d.source))));
}

export const esmToCjs: Transform = {
  name: 'esm-to-cjs',
  summary: 'a JavaScript ES module rewritten as CommonJS: `import` becomes `require`',
  plan: ({ p }) => esmToCjsPlan(p),
};

function importText(declarator: TSESTree.VariableDeclarator, source: string): string | null {
  const init = declarator.init;
  if (init?.type === 'MemberExpression') {
    // `require(m).default` has no single ESM spelling: what it reads depends on how the package is built.
    if (init.computed || init.property.type !== 'Identifier' || init.property.name === 'default' || declarator.id.type !== 'Identifier') {
      return null;
    }
    const prop = init.property.name;
    return `import { ${prop === declarator.id.name ? prop : `${prop} as ${declarator.id.name}`} } from ${source};`;
  }
  if (declarator.id.type === 'Identifier') return `import ${declarator.id.name} from ${source};`;
  if (declarator.id.type !== 'ObjectPattern') return null;
  const props = simplePattern(declarator.id);
  if (props === null) return null;
  const specifiers = props.map((prop) => {
    const key = (prop.key as TSESTree.Identifier).name;
    const local = (prop.value as TSESTree.Identifier).name;
    return key === local ? key : `${key} as ${local}`;
  });
  return `import { ${specifiers.join(', ')} } from ${source};`;
}

function moduleExportEdit(p: Parsed, statement: TSESTree.ExpressionStatement): Edit | null {
  const e = statement.expression;
  if (e.type !== 'AssignmentExpression' || e.operator !== '=' || e.left.type !== 'MemberExpression' || e.left.computed) return null;
  const target = textOf(p, e.left);
  if (target === 'module.exports') return replaceRange(statement.range, `export default ${textOf(p, e.right)};`);
  const named = /^(?:module\.exports|exports)\.([A-Za-z_$][\w$]*)$/u.exec(target)?.[1];
  if (named === undefined || e.right.type !== 'Identifier') return null;
  const spec = e.right.name === named ? named : `${e.right.name} as ${named}`;
  return replaceRange(statement.range, `export { ${spec} };`);
}

/** CommonJS to ESM, for JavaScript files whose every `require` and `module.exports` can be expressed as ESM. */
function cjsToEsmPlan(p: Parsed): Edit[] {
  if (!isJs(p)) return [];
  const edits: Edit[] = [];
  const handled = new Set<Node>();
  for (const statement of p.ast.body) {
    if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
      const [declarator] = statement.declarations;
      const module = requiredModule(declarator?.init);
      if (declarator === undefined || module === null) continue;
      const call = declarator.init?.type === 'MemberExpression' ? declarator.init.object : declarator.init;
      if (call?.type !== 'CallExpression') continue;
      const text = importText(declarator, textOf(p, call.arguments[0] as Node));
      if (text === null) return [];
      edits.push(replaceRange(statement.range, text));
      handled.add(call.callee);
    } else if (statement.type === 'ExpressionStatement') {
      const edit = moduleExportEdit(p, statement);
      if (edit === null) continue;
      edits.push(edit);
      handled.add(statement);
    }
  }
  if (edits.length === 0) return [];
  const globals = p.scopeManager.globalScope?.through ?? [];
  for (const reference of globals) {
    const { name } = reference.identifier as TSESTree.Identifier;
    if (name === '__dirname' || name === '__filename') {
      edits.push(replaceNode(p, reference.identifier, name === '__dirname' ? 'import.meta.dirname' : 'import.meta.filename'));
      continue;
    }
    if (name !== 'require' && name !== 'module' && name !== 'exports') continue;
    const inHandled = [...handled].some((h) => reference.identifier.range[0] >= h.range[0] && reference.identifier.range[1] <= h.range[1]);
    if (!inHandled) return [];
  }
  return edits;
}

export const cjsToEsm: Transform = {
  name: 'cjs-to-esm',
  summary: 'a CommonJS file rewritten as an ES module: `require` becomes `import`, `module.exports` becomes `export`',
  plan: ({ p }) => cjsToEsmPlan(p),
};

function moduleSpecifiers(p: Parsed): TSESTree.StringLiteral[] {
  const out: TSESTree.StringLiteral[] = [];
  for (const node of p.nodes) {
    if (
      (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ExportNamedDeclaration') &&
      node.source !== null
    ) {
      out.push(node.source);
    } else if (node.type === 'ImportExpression' && node.source.type === 'Literal' && typeof node.source.value === 'string') {
      out.push(node.source as TSESTree.StringLiteral);
    } else if (node.type === 'CallExpression' && requiredModule(node) !== null) {
      out.push(node.arguments[0] as TSESTree.StringLiteral);
    }
  }
  return out;
}

function prefixPlan(p: Parsed): Edit[] {
  const edits: Edit[] = [];
  for (const literal of moduleSpecifiers(p)) {
    const quote = textOf(p, literal)[0] ?? "'";
    const bare = literal.value.replace(/^node:/u, '');
    if (!BUILTINS.has(bare)) continue;
    const next = literal.value.startsWith('node:') ? bare : `node:${bare}`;
    edits.push(replaceRange(literal.range, `${quote}${next}${quote}`));
  }
  return edits;
}

export const nodePrefix: Transform = {
  name: 'node-prefix',
  summary: "Node builtins toggle the `node:` prefix: `'node:fs'` becomes `'fs'` and back",
  plan: ({ p }) => prefixPlan(p),
};
