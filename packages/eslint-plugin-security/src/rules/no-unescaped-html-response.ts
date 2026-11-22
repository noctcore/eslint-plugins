import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { isProvenSafeValue } from '../guards';

const RULE_NAME = 'no-unescaped-html-response';

export interface NoUnescapedHtmlResponseOptions {
  /** Receivers whose `send` / `end` / `write` write the response body. Replaces the defaults. */
  readonly responseObjects?: readonly string[];
  /**
   * Functions whose result is safe to place in HTML: escapers and sanitizers.
   * An entry with a dot (`he.encode`) matches that callee exactly; an entry
   * without one (`escapeHtml`) matches a bare call or any method of that name.
   * Replaces the defaults.
   */
  readonly sanitizers?: readonly string[];
}

type RuleOptions = [NoUnescapedHtmlResponseOptions];
type MessageIds = 'unescapedHtmlResponse' | 'rawTemplateValue';

/*
 * Server-side XSS, OPT-IN. Express sends a string as `text/html`, so
 * `res.send('<p>' + name + '</p>')` renders whatever `name` holds as markup.
 * Template engines escape by default, until a variable is marked raw
 * (`{{ bio | safe }}`, `<%- bio %>`).
 *
 * The rule judges the HTML being built, not where each value came from, the
 * way `no-shell-interpolation` judges a command: a value read from the
 * database (stored XSS) counts the same as one read from the request.
 *
 *  - `res.send` / `res.end` / `res.write` (also after chained calls such as
 *    `res.status(200).send`) of a template or `+` concatenation, followed
 *    through in-file `const` bindings, whose author-written text contains a
 *    tag (`<` then a letter, `/` or `!`) and a runtime part that is not proven
 *    safe;
 *  - `renderString(template, context)` (nunjucks) and `ejs.render(template,
 *    data)` with a literal template that marks a key raw, when the context
 *    object binds that key to a value that is not proven safe.
 *
 * Proven safe: literals and in-file `const` literals, numbers, the result of a
 * configured escaper or sanitizer (the outermost call decides), a `.replace`
 * chain that encodes `&`, `<`, `>` and `"`, and a value checked before the sink
 * against an allowlist or an anchored regex that admits none of `<>&"'` and
 * backtick (`../guards`). A function that first sets a non-HTML content type
 * is skipped, and `res.json` is never a sink.
 */

export const DEFAULT_RESPONSE_OBJECTS: readonly string[] = ['res', 'response'];

export const DEFAULT_SANITIZERS: readonly string[] = [
  'escapeHtml',
  'escapeHTML',
  'htmlEscape',
  'encodeHTML',
  'escape',
  'he.encode',
  'he.escape',
  'sanitize',
  'sanitizeHtml',
  'xss',
  'filterXSS',
  // React escapes text it renders; raw HTML needs `dangerouslySetInnerHTML`,
  // which `require-sanitized-html` checks.
  'renderToString',
  'renderToStaticMarkup',
];

/**
 * Escaping and sanitizing exports of common modules, by module name. An
 * import or `require` of one of these under any local name counts as a
 * sanitizer, so `import { encode } from 'he'` makes `encode(x)` safe.
 * `default` stands for the module's default export (or the `require` result).
 */
const ESCAPING_MODULES: Readonly<Record<string, readonly string[]>> = {
  he: ['encode', 'escape'],
  entities: ['encode', 'encodeHTML', 'escape', 'escapeUTF8'],
  'escape-html': ['default'],
  'html-escaper': ['escape'],
  'lodash.escape': ['default'],
  'lodash/escape': ['default'],
  lodash: ['escape'],
  'lodash-es': ['escape'],
  xss: ['default', 'filterXSS'],
  'sanitize-html': ['default'],
  'react-dom/server': ['renderToString', 'renderToStaticMarkup'],
};

const BODY_WRITERS: ReadonlySet<string> = new Set(['send', 'end', 'write']);
/** Response methods that return the response, so a writer after them is on the response. */
const CHAINABLE: ReadonlySet<string> = new Set([
  'status',
  'type',
  'set',
  'header',
  'append',
  'cookie',
  'clearCookie',
  'vary',
  'links',
  'location',
  'contentType',
]);
const CONTENT_TYPE_SETTERS: ReadonlySet<string> = new Set(['set', 'header', 'setHeader']);
const NUMERIC_CALLS: ReadonlySet<string> = new Set(['Number', 'parseInt', 'parseFloat']);
const NUMERIC_PROPERTIES: ReadonlySet<string> = new Set(['length', 'size']);
/** The characters a hand-written escape chain must encode. */
const MUST_ENCODE = ['&', '<', '>', '"'];
const TAG = /<[a-z!/]/iu;
const MAX_DEPTH = 8;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    responseObjects: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Receivers whose `send`, `end` and `write` calls write the response body. Replaces the defaults (`res`, `response`).',
    },
    sanitizers: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Functions whose result is safe in HTML. An entry with a dot (`he.encode`) matches that callee; one without (`escapeHtml`) matches a bare call or any method of that name. Replaces the defaults.',
    },
  },
};

type SourceCode = Readonly<TSESLint.SourceCode>;

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

function unwrap(node: TSESTree.Node): TSESTree.Node {
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

/** The initializer of an in-file `const` the identifier names, else null. */
function constInit(node: TSESTree.Identifier, sourceCode: SourceCode): TSESTree.Expression | null {
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  const def = variable?.defs[0];
  if (
    variable?.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'const' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier ||
    def.node.init === null
  ) {
    return null;
  }
  return def.node.init;
}

/** Follows `const` bindings to the expression they were built from. */
function resolve(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.Node {
  let current = unwrap(node);
  for (let depth = 0; depth < MAX_DEPTH && current.type === AST_NODE_TYPES.Identifier; depth += 1) {
    const init = constInit(current, sourceCode);
    if (init === null) {
      return current;
    }
    current = unwrap(init);
  }
  return current;
}

/** The receiver with response-returning calls peeled: `res.status(200)` gives `res`. */
function rootReceiver(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.CallExpression &&
    current.callee.type === AST_NODE_TYPES.MemberExpression &&
    !current.callee.computed &&
    current.callee.property.type === AST_NODE_TYPES.Identifier &&
    CHAINABLE.has(current.callee.property.name)
  ) {
    current = current.callee.object;
  }
  return current;
}

interface HtmlParts {
  readonly text: string;
  readonly dynamic: TSESTree.Node[];
}

/** Author text and runtime parts of a template or `+` chain; null for any other shape. */
function htmlParts(node: TSESTree.Node, sourceCode: SourceCode): HtmlParts | null {
  const resolved = resolve(node, sourceCode);
  if (resolved.type !== AST_NODE_TYPES.TemplateLiteral && resolved.type !== AST_NODE_TYPES.BinaryExpression) {
    return null;
  }
  if (resolved.type === AST_NODE_TYPES.BinaryExpression && resolved.operator !== '+') {
    return null;
  }
  let text = '';
  const dynamic: TSESTree.Node[] = [];
  const visit = (part: TSESTree.Node): void => {
    const inner = unwrap(part);
    if (inner.type === AST_NODE_TYPES.Literal) {
      text += String(inner.value);
    } else if (inner.type === AST_NODE_TYPES.TemplateLiteral) {
      inner.quasis.forEach((quasi, index) => {
        text += quasi.value.cooked ?? quasi.value.raw;
        const expression = inner.expressions[index];
        if (expression !== undefined) {
          visit(expression);
        }
      });
    } else if (inner.type === AST_NODE_TYPES.BinaryExpression && inner.operator === '+') {
      visit(inner.left);
      visit(inner.right);
    } else {
      dynamic.push(inner);
    }
  };
  visit(resolved);
  return { text, dynamic };
}

/** Characters a `.replace` / `.replaceAll` first argument encodes. */
function replacedCharacters(argument: TSESTree.Node | undefined): string {
  if (argument === undefined) {
    return '';
  }
  const inner = unwrap(argument);
  if (inner.type !== AST_NODE_TYPES.Literal) {
    return '';
  }
  if (typeof inner.value === 'string') {
    return inner.value.length === 1 ? inner.value : '';
  }
  if ('regex' in inner) {
    const pattern = inner.regex.pattern.replace(/\\(.)/gu, '$1');
    if (pattern.startsWith('[') && pattern.endsWith(']') && !pattern.startsWith('[^')) {
      return pattern.slice(1, -1);
    }
    return pattern.length === 1 ? pattern : '';
  }
  return '';
}

class SafetyJudge {
  constructor(
    private readonly sourceCode: SourceCode,
    private readonly sanitizerTexts: ReadonlySet<string>,
    private readonly sanitizerNames: ReadonlySet<string>,
  ) {}

  /** True when `node`, written into HTML at `sink`, cannot carry markup. */
  isSafe(node: TSESTree.Node, sink: TSESTree.Node, depth = 0): boolean {
    if (depth > MAX_DEPTH) {
      return false;
    }
    const inner = unwrap(node);
    if (isProvenSafeValue(inner, sink, 'html', this.sourceCode)) {
      return true;
    }
    switch (inner.type) {
      case AST_NODE_TYPES.Literal:
        return true;
      case AST_NODE_TYPES.UnaryExpression:
        return inner.operator === '-' || inner.operator === '+' || inner.operator === '!' || inner.operator === 'typeof';
      case AST_NODE_TYPES.BinaryExpression:
        // Arithmetic yields a number and comparisons a boolean; only `+` can build text.
        return inner.operator !== '+';
      case AST_NODE_TYPES.ConditionalExpression:
        return this.isSafe(inner.consequent, sink, depth + 1) && this.isSafe(inner.alternate, sink, depth + 1);
      case AST_NODE_TYPES.LogicalExpression:
        return this.isSafe(inner.left, sink, depth + 1) && this.isSafe(inner.right, sink, depth + 1);
      case AST_NODE_TYPES.TemplateLiteral:
        return inner.expressions.every((expression) => this.isSafe(expression, sink, depth + 1));
      case AST_NODE_TYPES.MemberExpression:
        return (
          !inner.computed &&
          inner.property.type === AST_NODE_TYPES.Identifier &&
          NUMERIC_PROPERTIES.has(inner.property.name)
        );
      case AST_NODE_TYPES.CallExpression:
        return this.isSafeCall(inner, sink, depth);
      case AST_NODE_TYPES.Identifier: {
        const init = constInit(inner, this.sourceCode);
        return init !== null && this.isSafe(init, sink, depth + 1);
      }
      default:
        return false;
    }
  }

  private isSafeCall(node: TSESTree.CallExpression, sink: TSESTree.Node, depth: number): boolean {
    const callee = node.callee;
    if (callee.type === AST_NODE_TYPES.Identifier) {
      return NUMERIC_CALLS.has(callee.name) || this.sanitizerNames.has(callee.name);
    }
    if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed) {
      return false;
    }
    if (this.sanitizerTexts.has(squash(this.sourceCode.getText(callee)))) {
      return true;
    }
    if (callee.property.type !== AST_NODE_TYPES.Identifier) {
      return false;
    }
    const method = callee.property.name;
    if (this.sanitizerNames.has(method)) {
      return true;
    }
    if (callee.object.type === AST_NODE_TYPES.Identifier && callee.object.name === 'Math') {
      return true;
    }
    if (method === 'toFixed' || method === 'toPrecision') {
      return true;
    }
    if (method === 'replace' || method === 'replaceAll') {
      return this.encodesHtml(node);
    }
    if (method === 'toString' && node.arguments.length === 0) {
      return this.isSafe(callee.object, sink, depth + 1);
    }
    return false;
  }

  /** True for a `.replace` chain that encodes at least `&`, `<`, `>` and `"`. */
  private encodesHtml(node: TSESTree.CallExpression): boolean {
    let encoded = '';
    let current: TSESTree.Node = node;
    for (let depth = 0; depth < 16; depth += 1) {
      const inner = unwrap(current);
      if (
        inner.type !== AST_NODE_TYPES.CallExpression ||
        inner.callee.type !== AST_NODE_TYPES.MemberExpression ||
        inner.callee.computed ||
        inner.callee.property.type !== AST_NODE_TYPES.Identifier ||
        (inner.callee.property.name !== 'replace' && inner.callee.property.name !== 'replaceAll')
      ) {
        break;
      }
      encoded += replacedCharacters(inner.arguments[0]);
      current = inner.callee.object;
    }
    return MUST_ENCODE.every((char) => encoded.includes(char));
  }
}

/** Keys a literal template marks raw: nunjucks `{{ key | safe }}` and EJS `<%- key %>`. */
function rawKeys(template: string): Set<string> {
  const keys = new Set<string>();
  for (const match of template.matchAll(/\{\{-?\s*([A-Za-z_$][\w$]*)\s*((?:\|\s*[\w$]+(?:\([^)]*\))?\s*)+)-?\}\}/gu)) {
    const filters = (match[2] ?? '').split('|').map((filter) => filter.trim().replace(/\(.*$/u, ''));
    if (filters.includes('safe') && match[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  for (const match of template.matchAll(/<%-\s*([A-Za-z_$][\w$]*)\s*-?%>/gu)) {
    if (match[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return keys;
}

/** The literal text of a template argument (a string or expression-free template), else null. */
function literalText(node: TSESTree.Node, sourceCode: SourceCode): string | null {
  const resolved = resolve(node, sourceCode);
  if (resolved.type === AST_NODE_TYPES.Literal && typeof resolved.value === 'string') {
    return resolved.value;
  }
  if (resolved.type === AST_NODE_TYPES.TemplateLiteral && resolved.expressions.length === 0) {
    return resolved.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
  }
  return null;
}

/** True for `renderString(...)` (nunjucks, on any receiver) or `ejs.render(...)`. */
function isTemplateRender(node: TSESTree.CallExpression, sourceCode: SourceCode): boolean {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === 'renderString';
  }
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.computed || callee.property.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  if (callee.property.name === 'renderString') {
    return true;
  }
  return callee.property.name === 'render' && squash(sourceCode.getText(callee.object)) === 'ejs';
}

export const noUnescapedHtmlResponseRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'HTML built from a runtime value and sent with `res.send` / `res.end` / `res.write`, or bound to a raw template variable (`| safe`, `<%-`), must escape or sanitize the value: unescaped, it is server-side XSS.',
      cwe: ['CWE-79'],
      owasp: ['A03:2021'],
      securitySeverity: 6.1,
    },
    schema: [optionSchema],
    messages: {
      unescapedHtmlResponse:
        '`{{value}}` is written into an HTML response without escaping, so markup in it runs in the browser (XSS). Escape it (`escapeHtml(value)`), sanitize it, or send JSON with `res.json`.',
      rawTemplateValue:
        '`{{key}}` is marked raw in the template, so `{{value}}` is rendered without escaping (XSS). Drop the raw marker and let the engine escape it, or sanitize the value first.',
    },
  },
  defaultOptions: [{ responseObjects: DEFAULT_RESPONSE_OBJECTS, sanitizers: DEFAULT_SANITIZERS }],
  create(context, [options]) {
    const { sourceCode } = context;
    const responseObjects = new Set((options.responseObjects ?? DEFAULT_RESPONSE_OBJECTS).map(squash));
    const entries = (options.sanitizers ?? DEFAULT_SANITIZERS).map((entry) => squash(entry).replace(/\(\)$/u, ''));
    const sanitizerTexts = new Set(entries.filter((entry) => entry.includes('.')));
    const sanitizerNames = new Set(entries.filter((entry) => !entry.includes('.')));
    const judge = new SafetyJudge(sourceCode, sanitizerTexts, sanitizerNames);

    /** Records the local names an escaping module is bound to. */
    const bindEscapingModule = (module: string, local: string, imported: string | null): void => {
      const exports = ESCAPING_MODULES[module];
      if (exports === undefined) {
        return;
      }
      if (imported === null) {
        // The namespace or the `require` result: its methods, and itself when callable.
        for (const name of exports) {
          if (name === 'default') {
            sanitizerNames.add(local);
          } else {
            sanitizerTexts.add(`${local}.${name}`);
          }
        }
      } else if (exports.includes(imported)) {
        sanitizerNames.add(local);
      }
    };
    const requiredModule = (node: TSESTree.Node | null): string | null => {
      const inner = node === null ? null : unwrap(node);
      return inner?.type === AST_NODE_TYPES.CallExpression &&
        inner.callee.type === AST_NODE_TYPES.Identifier &&
        inner.callee.name === 'require' &&
        inner.arguments[0]?.type === AST_NODE_TYPES.Literal &&
        typeof inner.arguments[0].value === 'string'
        ? inner.arguments[0].value
        : null;
    };

    /** A literal non-HTML content type set on the response before `sink` in its function. */
    const sentAsNonHtml = (sink: TSESTree.CallExpression): boolean => {
      const isNonHtml = (value: TSESTree.Node | undefined): boolean => {
        const text = value === undefined ? null : literalText(value, sourceCode);
        return text !== null && !/html/iu.test(text);
      };
      let found = false;
      let scope: TSESTree.Node | null | undefined = sink.parent;
      while (
        scope != null &&
        scope.type !== AST_NODE_TYPES.FunctionDeclaration &&
        scope.type !== AST_NODE_TYPES.FunctionExpression &&
        scope.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
        scope.type !== AST_NODE_TYPES.Program
      ) {
        scope = scope.parent;
      }
      if (scope == null) {
        return false;
      }
      const visit = (node: TSESTree.Node): void => {
        if (found || node.range[0] >= sink.range[1]) {
          return;
        }
        if (
          node.type === AST_NODE_TYPES.CallExpression &&
          node.callee.type === AST_NODE_TYPES.MemberExpression &&
          !node.callee.computed &&
          node.callee.property.type === AST_NODE_TYPES.Identifier &&
          responseObjects.has(squash(sourceCode.getText(rootReceiver(node.callee.object))))
        ) {
          const method = node.callee.property.name;
          const [first, second] = node.arguments;
          if ((method === 'type' || method === 'contentType') && isNonHtml(first)) {
            found = true;
          } else if (
            CONTENT_TYPE_SETTERS.has(method) &&
            first !== undefined &&
            literalText(first, sourceCode)?.toLowerCase() === 'content-type' &&
            isNonHtml(second)
          ) {
            found = true;
          }
        }
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const child = (node as unknown as Record<string, unknown>)[key];
          if (Array.isArray(child)) {
            for (const item of child) {
              if (item !== null && typeof item === 'object' && 'type' in item) {
                visit(item as TSESTree.Node);
              }
            }
          } else if (child !== null && typeof child === 'object' && 'type' in child) {
            visit(child as TSESTree.Node);
          }
        }
      };
      visit(scope);
      return found;
    };

    const checkResponseWrite = (node: TSESTree.CallExpression): void => {
      const callee = node.callee;
      if (
        callee.type !== AST_NODE_TYPES.MemberExpression ||
        callee.computed ||
        callee.property.type !== AST_NODE_TYPES.Identifier ||
        !BODY_WRITERS.has(callee.property.name) ||
        !responseObjects.has(squash(sourceCode.getText(rootReceiver(callee.object))))
      ) {
        return;
      }
      const body = node.arguments[0];
      if (body === undefined || body.type === AST_NODE_TYPES.SpreadElement) {
        return;
      }
      const parts = htmlParts(body, sourceCode);
      if (parts === null || !TAG.test(parts.text)) {
        return;
      }
      const unsafe = parts.dynamic.find((part) => !judge.isSafe(part, node));
      if (unsafe === undefined || sentAsNonHtml(node)) {
        return;
      }
      context.report({
        node: unsafe,
        messageId: 'unescapedHtmlResponse',
        data: { value: sourceCode.getText(unsafe) },
      });
    };

    const checkTemplateRender = (node: TSESTree.CallExpression): void => {
      if (!isTemplateRender(node, sourceCode)) {
        return;
      }
      const [template, data] = node.arguments;
      if (template === undefined || data === undefined || template.type === AST_NODE_TYPES.SpreadElement || data.type === AST_NODE_TYPES.SpreadElement) {
        return;
      }
      const text = literalText(template, sourceCode);
      const object = resolve(data, sourceCode);
      if (text === null || object.type !== AST_NODE_TYPES.ObjectExpression) {
        return;
      }
      const raw = rawKeys(text);
      for (const property of object.properties) {
        if (property.type !== AST_NODE_TYPES.Property || property.computed) {
          continue;
        }
        const key =
          property.key.type === AST_NODE_TYPES.Identifier
            ? property.key.name
            : property.key.type === AST_NODE_TYPES.Literal
              ? String(property.key.value)
              : null;
        if (key === null || !raw.has(key)) {
          continue;
        }
        const value = property.value;
        if (
          value.type === AST_NODE_TYPES.AssignmentPattern ||
          value.type === AST_NODE_TYPES.ArrayPattern ||
          value.type === AST_NODE_TYPES.ObjectPattern ||
          value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression ||
          judge.isSafe(value, node)
        ) {
          continue;
        }
        context.report({
          node: value,
          messageId: 'rawTemplateValue',
          data: { key, value: sourceCode.getText(value) },
        });
      }
    };

    return {
      ImportDeclaration(node): void {
        const module = String(node.source.value);
        for (const specifier of node.specifiers) {
          if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
            bindEscapingModule(module, specifier.local.name, null);
          } else if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
            bindEscapingModule(module, specifier.local.name, 'default');
          } else {
            const imported =
              specifier.imported.type === AST_NODE_TYPES.Identifier
                ? specifier.imported.name
                : String(specifier.imported.value);
            bindEscapingModule(module, specifier.local.name, imported);
          }
        }
      },
      VariableDeclarator(node): void {
        const module = requiredModule(node.init);
        if (module === null) {
          return;
        }
        if (node.id.type === AST_NODE_TYPES.Identifier) {
          bindEscapingModule(module, node.id.name, null);
        } else if (node.id.type === AST_NODE_TYPES.ObjectPattern) {
          for (const property of node.id.properties) {
            if (
              property.type === AST_NODE_TYPES.Property &&
              !property.computed &&
              property.key.type === AST_NODE_TYPES.Identifier &&
              property.value.type === AST_NODE_TYPES.Identifier
            ) {
              bindEscapingModule(module, property.value.name, property.key.name);
            }
          }
        }
      },
      CallExpression(node): void {
        checkResponseWrite(node);
        checkTemplateRender(node);
      },
    };
  },
});
