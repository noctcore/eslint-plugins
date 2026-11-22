import { statSync } from 'node:fs';
import path from 'node:path';

import { createFileCache } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';
import ts from 'typescript';

import { createRule } from '../createRule';
import {
  DEFAULT_EVENT_FIELD,
  DEFAULT_LOG_METHODS,
  DEFAULT_LOGGERS,
  findProperty,
  type LoggerCallOptions,
  loggerCallMatcher,
  loggerCallMethod,
  loggerCallOptionProperties,
  logPayload,
} from '../utils';

const RULE_NAME = 'typed-event-names';

export interface TypedEventNamesOptions extends LoggerCallOptions {
  readonly eventNamesModule?: string;
  readonly eventNamesExport?: string;
  readonly eventField?: string;
}

type RuleOptions = [TypedEventNamesOptions];
type MessageIds = 'unknownEvent' | 'unknownEntry' | 'nonLiteralEvent' | 'configError';

/*
 * `require-event-field` makes every log line carry an event identifier; this
 * rule makes the identifier one the project declared. The names live in one
 * module as an exported constant, a tuple
 * (`export const LOG_EVENTS = ['invoice.paid', 'invoice.failed'] as const`) or
 * an object whose string values are the names
 * (`export const LOG_EVENTS = { invoicePaid: 'invoice.paid' } as const`, nested
 * objects included). A typo or a stale name then fails at lint time, without
 * the type checker.
 *
 * The event field of every object-literal argument of a logger call is checked:
 *   - a string literal, or a template literal without expressions, must be one
 *     of the declared names;
 *   - `LOG_EVENTS.invoicePaid` (any member path from the export's name, or an
 *     index into a tuple) must name an entry that exists;
 *   - each branch of a conditional is checked on its own;
 *   - anything else (a variable, a call, an interpolated template) is reported,
 *     because it cannot be checked.
 *
 * The module is read with the TypeScript parser and cached on its path and
 * mtime. When it cannot be found, read, or does not export a constant array or
 * object of strings under `eventNamesExport`, the rule reports that once per
 * linted file, on the first event field, instead of going quiet: a rule that
 * silently stops checking reads as coverage the project does not have.
 */
const DEFAULT_EVENT_NAMES_EXPORT = 'LOG_EVENTS';

const MODULE_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    eventNamesModule: {
      type: 'string',
      minLength: 1,
      description:
        'Path to the module that exports the event names, resolved against the working directory and then against the linted file. The extension may be left off.',
    },
    eventNamesExport: {
      type: 'string',
      minLength: 1,
      default: DEFAULT_EVENT_NAMES_EXPORT,
      description: 'The exported constant that holds the names: a tuple of strings or an object of strings.',
    },
    eventField: {
      type: 'string',
      minLength: 1,
      default: DEFAULT_EVENT_FIELD,
      description: 'The payload key that holds the event identifier.',
    },
    ...loggerCallOptionProperties,
  },
};

/** A declared value: a name, a tuple of values or an object of values. */
type EventTree =
  | { readonly kind: 'name'; readonly value: string }
  | { readonly kind: 'array'; readonly items: readonly EventTree[] }
  | { readonly kind: 'object'; readonly entries: ReadonlyMap<string, EventTree> };

interface EventCatalog {
  readonly tree: EventTree;
  readonly names: ReadonlySet<string>;
}

type CatalogResult =
  | { readonly ok: true; readonly catalog: EventCatalog }
  | { readonly ok: false; readonly reason: string };

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/u.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

// Module path -> parsed source, re-parsed when the mtime moves.
const moduleCache = createFileCache(
  (text, file) => ({
    source: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file)),
    catalogs: new Map<string, CatalogResult>(),
  }),
);

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The first existing file for `spec`: against `cwd`, then the linted file's folder, with or without an extension. */
function resolveModule(spec: string, cwd: string, filename: string): string | null {
  const bases = path.isAbsolute(spec)
    ? [spec]
    : [path.resolve(cwd, spec), path.resolve(path.dirname(filename), spec)];
  for (const base of bases) {
    if (isFile(base)) {
      return base;
    }
    for (const extension of MODULE_EXTENSIONS) {
      if (isFile(base + extension)) {
        return base + extension;
      }
    }
  }
  return null;
}

function isExported(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** The `const` declaration of `name` among the top-level statements, and whether it is exported. */
function findConst(
  source: ts.SourceFile,
  name: string,
): { declaration: ts.VariableDeclaration; isConst: boolean; exported: boolean } | null {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
        return {
          declaration,
          isConst: (statement.declarationList.flags & ts.NodeFlags.Const) !== 0,
          exported: isExported(statement),
        };
      }
    }
  }
  return null;
}

/** The local name an `export { local as exportName }` list gives `exportName`, or null. */
function localNameOfExport(source: ts.SourceFile, exportName: string): string | null {
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text === exportName) {
          return (element.propertyName ?? element.name).text;
        }
      }
    }
  }
  return null;
}

/** Strip `as const`, `satisfies`, parentheses and `Object.freeze(...)`. */
function unwrapInitializer(node: ts.Expression): ts.Expression {
  let current = node;
  for (;;) {
    if (
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    if (
      ts.isCallExpression(current) &&
      current.arguments.length === 1 &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === 'Object' &&
      current.expression.name.text === 'freeze'
    ) {
      current = current.arguments[0] as ts.Expression;
      continue;
    }
    return current;
  }
}

/** Read a declared value, or a reason string when part of it is not a plain string, tuple or object. */
function readTree(node: ts.Expression): EventTree | string {
  const value = unwrapInitializer(node);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
    return { kind: 'name', value: value.text };
  }
  if (ts.isArrayLiteralExpression(value)) {
    const items: EventTree[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
        return 'an array element is a spread or a hole';
      }
      const item = readTree(element);
      if (typeof item === 'string') {
        return item;
      }
      items.push(item);
    }
    return { kind: 'array', items };
  }
  if (ts.isObjectLiteralExpression(value)) {
    const entries = new Map<string, EventTree>();
    for (const property of value.properties) {
      if (
        !ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name))
      ) {
        return 'an object entry is not a plain `key: value` pair';
      }
      const entry = readTree(property.initializer);
      if (typeof entry === 'string') {
        return entry;
      }
      entries.set(property.name.text, entry);
    }
    return { kind: 'object', entries };
  }
  return `\`${value.getText()}\` is not a string, an array or an object literal`;
}

function collectNames(tree: EventTree, into: Set<string>): void {
  if (tree.kind === 'name') {
    into.add(tree.value);
  } else if (tree.kind === 'array') {
    tree.items.forEach((item) => collectNames(item, into));
  } else {
    tree.entries.forEach((entry) => collectNames(entry, into));
  }
}

function readCatalog(source: ts.SourceFile, exportName: string): CatalogResult {
  let found = findConst(source, exportName);
  if (found === null || !found.exported) {
    const local = localNameOfExport(source, exportName);
    found = local === null ? null : findConst(source, local);
  }
  if (found === null) {
    return { ok: false, reason: `it has no top-level exported \`${exportName}\`` };
  }
  if (!found.isConst) {
    return { ok: false, reason: `\`${exportName}\` is not declared with \`const\`` };
  }
  const initializer = found.declaration.initializer;
  if (initializer === undefined) {
    return { ok: false, reason: `\`${exportName}\` has no value` };
  }
  const tree = readTree(initializer);
  if (typeof tree === 'string') {
    return { ok: false, reason: `\`${exportName}\` cannot be read statically: ${tree}` };
  }
  if (tree.kind === 'name') {
    return { ok: false, reason: `\`${exportName}\` must be an array or an object of strings` };
  }
  const names = new Set<string>();
  collectNames(tree, names);
  if (names.size === 0) {
    return { ok: false, reason: `\`${exportName}\` declares no event names` };
  }
  return { ok: true, catalog: { tree, names } };
}

/** Load the catalog for the rule's options, with a reason when it cannot be used. */
function loadCatalog(
  spec: string | undefined,
  exportName: string,
  cwd: string,
  filename: string,
): CatalogResult {
  if (spec === undefined) {
    return { ok: false, reason: '`eventNamesModule` is not set' };
  }
  const file = resolveModule(spec, cwd, filename);
  if (file === null) {
    return { ok: false, reason: `\`${spec}\` was not found` };
  }
  const entry = moduleCache.get(file);
  if (entry === undefined) {
    return { ok: false, reason: `\`${spec}\` could not be read` };
  }
  let result = entry.catalogs.get(exportName);
  if (result === undefined) {
    result = readCatalog(entry.source, exportName);
    entry.catalogs.set(exportName, result);
  }
  return result;
}

/** Edit distance, capped: enough to suggest `invoice.paid` for `invoice.payed`. */
function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0] as number;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j] as number;
      previous[j] = Math.min(
        above + 1,
        (previous[j - 1] as number) + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length] as number;
}

/** The closest declared name within two edits, as a message hint, or an empty string. */
function closestHint(name: string, names: ReadonlySet<string>): string {
  let best: string | null = null;
  let bestDistance = 3;
  for (const candidate of names) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best === null ? '' : ` Did you mean \`${best}\`?`;
}

function unwrapValue(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression
  ) {
    current = current.expression;
  }
  return current;
}

/** The static string a literal or expression-free template holds, or null. */
function staticString(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value;
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** The keys of a member path rooted at `root` (`LOG_EVENTS.invoice.paid` → `['invoice', 'paid']`), or null. */
function memberPath(node: TSESTree.Node, root: string): string[] | null {
  const keys: string[] = [];
  let current = node;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    const property = current.property;
    if (!current.computed && property.type === AST_NODE_TYPES.Identifier) {
      keys.unshift(property.name);
    } else if (
      current.computed &&
      property.type === AST_NODE_TYPES.Literal &&
      (typeof property.value === 'string' || typeof property.value === 'number')
    ) {
      keys.unshift(String(property.value));
    } else {
      return null;
    }
    current = current.object;
  }
  return current.type === AST_NODE_TYPES.Identifier && current.name === root && keys.length > 0
    ? keys
    : null;
}

/** Follow a member path through the declared tree: the name it ends on, `null` for a missing entry, or `undefined` when it ends on a group. */
function followPath(tree: EventTree, keys: readonly string[]): string | null | undefined {
  let current: EventTree | undefined = tree;
  for (const key of keys) {
    if (current === undefined || current.kind === 'name') {
      return null;
    }
    current = current.kind === 'array' ? current.items[Number(key)] : current.entries.get(key);
  }
  if (current === undefined) {
    return null;
  }
  return current.kind === 'name' ? current.value : undefined;
}

export const typedEventNamesRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'The event field of a logger call must be a name declared in the project event names module, so a typo or a stale name fails at lint time.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      unknownEvent:
        '`{{name}}` is not declared in `{{exportName}}` ({{module}}).{{hint}} Use a declared event name, or add this one to the list.',
      unknownEntry: '`{{text}}` is not an entry of `{{exportName}}` ({{module}}).',
      nonLiteralEvent:
        'The `{{field}}` value must be a string literal or a `{{exportName}}` entry so it can be checked against `{{exportName}}`; a computed value hides typos and stale names.',
      configError:
        '`typed-event-names` cannot check event names: {{reason}}. Fix `eventNamesModule` / `eventNamesExport` in the rule options.',
    },
  },
  defaultOptions: [
    {
      eventNamesExport: DEFAULT_EVENT_NAMES_EXPORT,
      eventField: DEFAULT_EVENT_FIELD,
      loggers: DEFAULT_LOGGERS,
      methods: DEFAULT_LOG_METHODS,
    },
  ],
  create(context, [options]) {
    const matcher = loggerCallMatcher(options);
    const field = options.eventField ?? DEFAULT_EVENT_FIELD;
    const exportName = options.eventNamesExport ?? DEFAULT_EVENT_NAMES_EXPORT;
    const modulePath = options.eventNamesModule ?? '';
    let result: CatalogResult | undefined;
    let configReported = false;

    const check = (node: TSESTree.Node, catalog: EventCatalog): void => {
      const value = unwrapValue(node);
      if (value.type === AST_NODE_TYPES.ConditionalExpression) {
        check(value.consequent, catalog);
        check(value.alternate, catalog);
        return;
      }
      const name = staticString(value);
      if (name !== null) {
        if (!catalog.names.has(name)) {
          context.report({
            node: value,
            messageId: 'unknownEvent',
            data: { name, exportName, module: modulePath, hint: closestHint(name, catalog.names) },
          });
        }
        return;
      }
      const keys = memberPath(value, exportName);
      if (keys !== null) {
        const followed = followPath(catalog.tree, keys);
        if (followed === null) {
          context.report({
            node: value,
            messageId: 'unknownEntry',
            data: { text: context.sourceCode.getText(value), exportName, module: modulePath },
          });
        } else if (followed === undefined) {
          context.report({ node: value, messageId: 'nonLiteralEvent', data: { field, exportName } });
        }
        return;
      }
      context.report({ node: value, messageId: 'nonLiteralEvent', data: { field, exportName } });
    };

    return {
      CallExpression(node): void {
        if (loggerCallMethod(node, matcher) === null) {
          return;
        }
        for (const object of logPayload(node).objects) {
          const property = findProperty(object, field);
          if (property === null) {
            continue;
          }
          result ??= loadCatalog(options.eventNamesModule, exportName, context.cwd, context.filename);
          if (!result.ok) {
            if (!configReported) {
              configReported = true;
              context.report({ node: property, messageId: 'configError', data: { reason: result.reason } });
            }
            return;
          }
          check(property.value, result.catalog);
        }
      },
    };
  },
});
