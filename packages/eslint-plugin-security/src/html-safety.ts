import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { type GuardContext, isProvenSafeValue } from './guards';
import type { HtmlContext } from './html-context';

/*
 * Whether a runtime value is safe where it lands in HTML (`./html-context`),
 * for `no-unescaped-html-response`.
 *
 * A value is safe in a context when it is a constant (a literal, a number, a
 * boolean), a value a guard proves for that context (`./guards`), or the
 * result of an encoder that is enough there. Encoders are recognized by their
 * import (`import { encode } from 'he'`), never by a bare name that any
 * method may share (`mysql.escape`), apart from the configured `sanitizers`.
 * Sanitizer options that switch protection off (`allowedTags: false`,
 * `RETURN_DOM`, an `on*` attribute) make the call count as no sanitizer.
 */

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;

/**
 * What an encoder's output is safe for.
 *
 *  - `escape-all`: `&<>"'` encoded (escape-html, he, lodash `escape`).
 *  - `escape-quot`: `&<>"` encoded: a configured escaper, or a `.replace`
 *    chain without `'`.
 *  - `escape-text`: `&<>` only (entities `escapeText`).
 *  - `sanitized`: markup with the dangerous parts removed (DOMPurify,
 *    sanitize-html, xss, React rendering): safe as element content only.
 *  - `url-component`: `encodeURIComponent`: no space, quote, `<`, `>`, `&` or
 *    `:`, but `'` stays.
 *  - `url-escape`: the global `escape`, which also encodes `'`.
 *  - `script-json`: serialized for a script element (serialize-javascript,
 *    htmlescape), with `<` written as `<`.
 */
export type Encoding =
  | 'escape-all'
  | 'escape-quot'
  | 'escape-text'
  | 'sanitized'
  | 'url-component'
  | 'url-escape'
  | 'script-json';

const SAFE_IN: Readonly<Record<Encoding, ReadonlySet<HtmlContext>>> = {
  'escape-all': new Set(['text', 'rcdata', 'attr-dq', 'attr-sq']),
  'escape-quot': new Set(['text', 'rcdata', 'attr-dq']),
  'escape-text': new Set(['text', 'rcdata']),
  sanitized: new Set(['text']),
  'url-component': new Set(['text', 'rcdata', 'attr-dq', 'attr-unquoted', 'url-dq', 'url-unquoted']),
  'url-escape': new Set(['text', 'rcdata', 'attr-dq', 'attr-sq', 'attr-unquoted', 'url-dq', 'url-sq', 'url-unquoted']),
  'script-json': new Set(['text', 'rcdata', 'script']),
};

/** Where a `.replace` step that writes `<br>` or entities leaves an escaped value safe. */
const MARKUP_SAFE: ReadonlySet<HtmlContext> = new Set(['text', 'rcdata', 'attr-dq', 'attr-sq']);

/** True when an encoding's output is safe in `context`. */
export function encodingSafeIn(encoding: Encoding, context: HtmlContext): boolean {
  return SAFE_IN[encoding].has(context);
}

type OptionsCheck = (call: TSESTree.CallExpression, judge: HtmlSafety) => boolean;

interface Encoder {
  readonly encoding: Encoding;
  /** True when the call's options keep the protection on. Without one, any extra argument is refused. */
  readonly options?: OptionsCheck;
}

interface ModuleSpec {
  /** What calling the default export (or the `require` result) does. */
  readonly callable?: Encoder;
  /** Exports, also reached as methods of the default export or namespace. */
  readonly named: Readonly<Record<string, Encoder>>;
  /** Calling the default export with a window returns an instance (dompurify). */
  readonly factory?: boolean;
}

const ESCAPE_ALL: Encoder = { encoding: 'escape-all' };
const HE_ENCODE: Encoder = { encoding: 'escape-all', options: (call, judge) => judge.heOptionsSafe(call) };
const SANITIZE_HTML: Encoder = { encoding: 'sanitized', options: (call, judge) => judge.sanitizeHtmlOptionsSafe(call) };
const XSS: Encoder = { encoding: 'sanitized', options: (call, judge) => judge.xssOptionsSafe(call) };
const DOMPURIFY: Encoder = { encoding: 'sanitized', options: (call, judge) => judge.domPurifyOptionsSafe(call) };
const REACT_RENDER: Encoder = { encoding: 'sanitized', options: () => true };
const SERIALIZE: Encoder = { encoding: 'script-json', options: (call, judge) => judge.serializeOptionsSafe(call) };
const SCRIPT_JSON: Encoder = { encoding: 'script-json' };

const REACT_DOM_SERVER: ModuleSpec = {
  named: { renderToString: REACT_RENDER, renderToStaticMarkup: REACT_RENDER },
};

/** Escaping and sanitizing modules, by import source. */
const MODULES: Readonly<Record<string, ModuleSpec>> = {
  he: { named: { encode: HE_ENCODE, escape: ESCAPE_ALL } },
  entities: {
    named: {
      encode: ESCAPE_ALL,
      encodeHTML: ESCAPE_ALL,
      encodeHTML4: ESCAPE_ALL,
      encodeHTML5: ESCAPE_ALL,
      encodeXML: ESCAPE_ALL,
      escape: ESCAPE_ALL,
      escapeUTF8: ESCAPE_ALL,
      escapeText: { encoding: 'escape-text' },
    },
  },
  'escape-html': { callable: ESCAPE_ALL, named: {} },
  'html-escaper': { named: { escape: ESCAPE_ALL } },
  'escape-goat': { named: { htmlEscape: ESCAPE_ALL } },
  lodash: { named: { escape: ESCAPE_ALL } },
  'lodash-es': { named: { escape: ESCAPE_ALL } },
  underscore: { named: { escape: ESCAPE_ALL } },
  'lodash.escape': { callable: ESCAPE_ALL, named: {} },
  'lodash/escape': { callable: ESCAPE_ALL, named: {} },
  'lodash-es/escape': { callable: ESCAPE_ALL, named: {} },
  validator: { named: { escape: ESCAPE_ALL } },
  'validator/lib/escape': { callable: ESCAPE_ALL, named: {} },
  xss: { callable: XSS, named: { filterXSS: XSS } },
  'sanitize-html': { callable: SANITIZE_HTML, named: {} },
  dompurify: { named: { sanitize: DOMPURIFY }, factory: true },
  'isomorphic-dompurify': { named: { sanitize: DOMPURIFY } },
  'react-dom/server': REACT_DOM_SERVER,
  'react-dom/server.node': REACT_DOM_SERVER,
  'react-dom/server.edge': REACT_DOM_SERVER,
  'react-dom/server.browser': REACT_DOM_SERVER,
  'serialize-javascript': { callable: SERIALIZE, named: {} },
  htmlescape: { callable: SCRIPT_JSON, named: { htmlescape: SCRIPT_JSON } },
};

/** Global functions that encode, called by name and not shadowed. */
const GLOBAL_ENCODERS: Readonly<Record<string, Encoding>> = {
  encodeURIComponent: 'url-component',
  escape: 'url-escape',
};

/** Tags that let script or a new document in when a sanitizer allows them. */
const DANGEROUS_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'textarea',
  'option',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'noscript',
  'xmp',
  'noembed',
  'noframes',
  'plaintext',
  'template',
  'svg',
  'math',
]);
/** DOMPurify keeps `style` safe itself; the rest it does not. */
const DOMPURIFY_DANGEROUS_TAGS: ReadonlySet<string> = new Set(
  [...DANGEROUS_TAGS].filter((tag) => tag !== 'style').concat(['iframe']),
);
const DANGEROUS_SCHEMES: ReadonlySet<string> = new Set(['javascript', 'vbscript']);
const NUMERIC_GLOBALS: ReadonlySet<string> = new Set(['Number', 'parseInt', 'parseFloat', 'Boolean', 'isNaN', 'isFinite']);
const NUMERIC_METHODS: ReadonlySet<string> = new Set(['toFixed', 'toPrecision', 'toExponential']);
/** `Date` methods whose result is a number or an ISO stamp. */
const DATE_METHODS: ReadonlySet<string> = new Set([
  'toISOString',
  'toJSON',
  'getTime',
  'valueOf',
  'getFullYear',
  'getMonth',
  'getDate',
  'getDay',
  'getHours',
  'getMinutes',
  'getSeconds',
  'getMilliseconds',
  'getUTCFullYear',
  'getUTCMonth',
  'getUTCDate',
  'getUTCDay',
  'getUTCHours',
  'getUTCMinutes',
  'getUTCSeconds',
  'getUTCMilliseconds',
  'getTimezoneOffset',
]);
/** Array methods that do not change the array. */
const READ_ONLY_ARRAY_METHODS: ReadonlySet<string> = new Set([
  'length',
  'map',
  'filter',
  'forEach',
  'join',
  'includes',
  'some',
  'every',
  'find',
  'findIndex',
  'slice',
  'indexOf',
  'at',
  'entries',
  'keys',
  'values',
]);
/** Fields of a request object that hold the requester's input. */
const REQUEST_FIELDS: ReadonlySet<string> = new Set(['query', 'params', 'body', 'headers', 'cookies', 'files', 'file']);
const REQUEST_OBJECTS: ReadonlySet<string> = new Set(['req', 'request', 'ctx']);
/** Nest parameter decorators that bind request input. */
const REQUEST_DECORATORS: ReadonlySet<string> = new Set(['Body', 'Query', 'Param', 'Headers']);
/** The characters an escaper must encode for each coverage level. */
const ESCAPE_QUOT_CHARS = ['&', '<', '>', '"'];
const ESCAPE_ALL_CHARS = [...ESCAPE_QUOT_CHARS, "'"];
/** Characters a replacement may not write once the value is escaped. */
const MARKUP = /[<>"'`]/u;
/** A replacement that writes only plain text, `<br>` tags and character references. */
const SAFE_MARKUP = /^(?:[^<>"'`&]|<br\s*\/?>|&(?:[a-z]+|#\d+|#x[\da-f]+);)*$/iu;
const MAX_DEPTH = 8;
const MAX_CLASS = 512;

/** How an import binds a module: a named export, the default export, or the namespace. */
export interface ModuleBinding {
  readonly module: string;
  /** The export name, `default`, or `*` for a namespace or a whole `require`. */
  readonly imported: string;
}

export interface HtmlSafetyOptions {
  /** Configured escapers called by bare name (`escapeHtml`). */
  readonly sanitizerNames: ReadonlySet<string>;
  /** Configured escapers by callee text (`utils.escapeHtml`). */
  readonly sanitizerTexts: ReadonlySet<string>;
}

export function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  for (;;) {
    if (
      current.type === AST_NODE_TYPES.TSAsExpression ||
      current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      current.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.type === AST_NODE_TYPES.TSTypeAssertion ||
      current.type === AST_NODE_TYPES.TSInstantiationExpression
    ) {
      current = current.expression;
    } else if (current.type === AST_NODE_TYPES.AwaitExpression) {
      current = current.argument;
    } else if (current.type === AST_NODE_TYPES.ChainExpression) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

/** The name of a member's property: `a.b` and `a['b']`. */
export function propertyName(node: TSESTree.MemberExpression): string | null {
  if (!node.computed && node.property.type === AST_NODE_TYPES.Identifier) {
    return node.property.name;
  }
  return node.property.type === AST_NODE_TYPES.Literal && typeof node.property.value === 'string'
    ? node.property.value
    : null;
}

/** The key of a non-computed object property, or a string or number literal key. */
export function propertyKey(property: TSESTree.Property): string | null {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name;
  }
  return property.key.type === AST_NODE_TYPES.Literal ? String(property.key.value) : null;
}

/** The text of a string literal or of a template without expressions. */
export function staticString(node: TSESTree.Node): string | null {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Literal && typeof inner.value === 'string') {
    return inner.value;
  }
  if (inner.type === AST_NODE_TYPES.TemplateLiteral && inner.expressions.length === 0) {
    return inner.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
  }
  return null;
}

type FunctionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration;

/**
 * The expression a function returns when its body is that expression, or a
 * block of `const` declarations ending in its only `return`.
 */
export function returnedExpression(fn: FunctionNode): TSESTree.Expression | null {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return fn.body;
  }
  const statements = fn.body.body;
  const last = statements.at(-1);
  const declarationsOnly = statements
    .slice(0, -1)
    .every((statement) => statement.type === AST_NODE_TYPES.VariableDeclaration && statement.kind === 'const');
  return last?.type === AST_NODE_TYPES.ReturnStatement && last.argument !== null && declarationsOnly
    ? last.argument
    : null;
}

/* ---------------------------------------------------------------------------
 * Regex and string patterns of a `.replace` step
 * ------------------------------------------------------------------------ */

interface PatternInfo {
  /** Every character a match can consume. */
  readonly matchable: ReadonlySet<string>;
  /** Characters every occurrence of which a global replace consumes. */
  readonly covers: ReadonlySet<string>;
}

interface Atom {
  readonly chars: ReadonlySet<string>;
  readonly min: number;
}

function withCase(chars: Set<string>): Set<string> {
  for (const char of [...chars]) {
    chars.add(char.toLowerCase());
    chars.add(char.toUpperCase());
  }
  return chars;
}

/** One escaped character after `\` at `index` (the backslash), or null when it is a class or unsupported. */
function escapedChar(pattern: string, index: number): { char: string; length: number } | null {
  const next = pattern[index + 1];
  if (next === undefined) {
    return null;
  }
  const controls: Record<string, string> = { n: '\n', r: '\r', t: '\t', f: '\f', v: '\v', '0': '\0' };
  if (next in controls && !(next === '0' && /\d/u.test(pattern[index + 2] ?? ''))) {
    return { char: controls[next] ?? '', length: 2 };
  }
  const hex = /^x([\da-f]{2})/iu.exec(pattern.slice(index + 1));
  if (hex?.[1] !== undefined) {
    return { char: String.fromCharCode(Number.parseInt(hex[1], 16)), length: 4 };
  }
  const unicode = /^u([\da-f]{4})/iu.exec(pattern.slice(index + 1));
  if (unicode?.[1] !== undefined) {
    return { char: String.fromCharCode(Number.parseInt(unicode[1], 16)), length: 6 };
  }
  // Classes (`\d`, `\w`, `\s`, `\p{...}`), boundaries and back references are not read.
  return /[a-z\d]/iu.test(next) ? null : { char: next, length: 2 };
}

function parseClass(pattern: string, start: number): { chars: Set<string>; end: number } | null {
  let i = start + 1;
  if (pattern[i] === '^') {
    return null;
  }
  const chars = new Set<string>();
  const items: string[] = [];
  while (i < pattern.length && pattern[i] !== ']') {
    let char = pattern[i] ?? '';
    let length = 1;
    if (char === '\\') {
      const escaped = escapedChar(pattern, i);
      if (escaped === null) {
        return null;
      }
      char = escaped.char;
      length = escaped.length;
    } else if (char === '[') {
      return null;
    }
    items.push(char);
    i += length;
    // A range `a-z` (a `-` before `]` is a literal dash).
    if (pattern[i] === '-' && pattern[i + 1] !== ']' && pattern[i + 1] !== undefined) {
      let end = pattern[i + 1] ?? '';
      let endLength = 1;
      if (end === '\\') {
        const escaped = escapedChar(pattern, i + 1);
        if (escaped === null) {
          return null;
        }
        end = escaped.char;
        endLength = escaped.length;
      }
      const from = char.codePointAt(0) ?? 0;
      const to = end.codePointAt(0) ?? 0;
      if (to < from || to - from > MAX_CLASS) {
        return null;
      }
      for (let code = from; code <= to; code += 1) {
        items.push(String.fromCodePoint(code));
      }
      i += 1 + endLength;
    }
  }
  if (pattern[i] !== ']') {
    return null;
  }
  for (const item of items) {
    chars.add(item);
  }
  return { chars, end: i + 1 };
}

/** Reads a regex made of single characters and classes with quantifiers, in alternatives. */
export function parseRegexPattern(pattern: string, flags: string): PatternInfo | null {
  if (flags.includes('v')) {
    return null;
  }
  const ignoreCase = flags.includes('i');
  const alternatives: Atom[][] = [[]];
  const anchored: boolean[] = [false];
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i] ?? '';
    const current = alternatives.at(-1) ?? [];
    if (char === '|') {
      alternatives.push([]);
      anchored.push(false);
      i += 1;
      continue;
    }
    if (char === '^' || char === '$') {
      anchored[anchored.length - 1] = true;
      i += 1;
      continue;
    }
    if ('().*+?{}'.includes(char)) {
      // Groups, lookarounds, `.` and stray quantifiers are not read.
      return null;
    }
    let chars: Set<string>;
    if (char === '[') {
      const parsed = parseClass(pattern, i);
      if (parsed === null) {
        return null;
      }
      chars = parsed.chars;
      i = parsed.end;
    } else if (char === '\\') {
      const escaped = escapedChar(pattern, i);
      if (escaped === null) {
        return null;
      }
      chars = new Set([escaped.char]);
      i += escaped.length;
    } else {
      chars = new Set([char]);
      i += 1;
    }
    let min = 1;
    const quantifier = /^(?:[?*+]|\{(\d+)(?:,\d*)?\})\??/u.exec(pattern.slice(i));
    if (quantifier !== null) {
      const head = quantifier[0][0];
      min = head === '?' || head === '*' ? 0 : head === '+' ? 1 : Number(quantifier[1] ?? '1');
      i += quantifier[0].length;
    }
    current.push({ chars: ignoreCase ? withCase(chars) : chars, min });
  }
  const matchable = new Set<string>();
  const covers = new Set<string>();
  let matchesEmpty = false;
  alternatives.forEach((atoms, index) => {
    for (const atom of atoms) {
      for (const char of atom.chars) {
        matchable.add(char);
      }
    }
    const required = atoms.filter((atom) => atom.min > 0);
    if (required.length === 0) {
      matchesEmpty = true;
    } else if (required.length === 1 && required[0]?.min === 1 && anchored[index] !== true) {
      // The alternative matches the character alone, so a global replace
      // consumes every occurrence of it.
      for (const char of required[0].chars) {
        covers.add(char);
      }
    }
  });
  // A pattern that can match the empty string may step over a character.
  return { matchable, covers: matchesEmpty ? new Set() : covers };
}

/** True when a replacement written in place of these characters can change a character reference. */
function touchesReferences(chars: ReadonlySet<string> | null): boolean {
  return chars === null || [...chars].some((char) => /[\da-z&#;]/iu.test(char));
}

/** True when a replacement string uses `$&`, `$1`, `` $` ``, `$'` or `$<name>`, which put the match back. */
function substitutes(replacement: string): boolean {
  for (let i = 0; i < replacement.length; i += 1) {
    if (replacement[i] === '$') {
      const next = replacement[i + 1] ?? '';
      if (next === '$') {
        i += 1;
      } else if (/[&`'<\d]/u.test(next)) {
        return true;
      }
    }
  }
  return false;
}

/* ---------------------------------------------------------------------------
 * The judge
 * ------------------------------------------------------------------------ */

type Replacement =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'map'; readonly keys: ReadonlySet<string> }
  | { readonly kind: 'charcode' }
  | { readonly kind: 'unknown' };

export class HtmlSafety {
  /** Local bindings of imported or required modules. */
  readonly bindings: Map<TSESLint.Scope.Variable, ModuleBinding> = new Map();
  /** DOMPurify instances made from the dompurify factory (`DOMPurify(window)`). */
  readonly purifiers: Set<TSESLint.Scope.Variable> = new Set();
  /** DOMPurify bindings given a config or hooks that switch protection off. */
  readonly weakenedPurifiers: Set<TSESLint.Scope.Variable> = new Set();

  constructor(
    private readonly sourceCode: SourceCode,
    private readonly options: HtmlSafetyOptions,
  ) {}

  variableOf(node: TSESTree.Identifier): Variable | null {
    return ASTUtils.findVariable(this.sourceCode.getScope(node), node);
  }

  /** True when `node` names the global `name`, not a local binding that shadows it. */
  isGlobal(node: TSESTree.Node, name: string): boolean {
    if (node.type !== AST_NODE_TYPES.Identifier || node.name !== name) {
      return false;
    }
    const variable = this.variableOf(node);
    return variable === null || variable.defs.length === 0;
  }

  /** The initializer of the single `const` declaration of `node`, else null. */
  constInit(node: TSESTree.Identifier): TSESTree.Expression | null {
    const variable = this.variableOf(node);
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

  /** The function an identifier or inline expression names, when it is in this file and never reassigned. */
  functionOf(node: TSESTree.Node): FunctionNode | null {
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.ArrowFunctionExpression || inner.type === AST_NODE_TYPES.FunctionExpression) {
      return inner;
    }
    if (inner.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    const init = this.constInit(inner);
    if (init !== null) {
      const fn = unwrap(init);
      return fn.type === AST_NODE_TYPES.ArrowFunctionExpression || fn.type === AST_NODE_TYPES.FunctionExpression
        ? fn
        : null;
    }
    const variable = this.variableOf(inner);
    const def = variable?.defs[0];
    if (
      variable?.defs.length === 1 &&
      def?.type === 'FunctionName' &&
      def.node.type === AST_NODE_TYPES.FunctionDeclaration &&
      variable.references.every((reference) => !reference.isWrite())
    ) {
      return def.node;
    }
    return null;
  }

  /* ---- encoders ------------------------------------------------------ */

  private moduleOf(identifier: TSESTree.Node): ModuleBinding | null {
    const inner = unwrap(identifier);
    if (inner.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    const variable = this.variableOf(inner);
    return variable === null ? null : (this.bindings.get(variable) ?? null);
  }

  private specOf(binding: ModuleBinding): ModuleSpec | null {
    return MODULES[binding.module] ?? null;
  }

  /** True when `node` is a DOMPurify instance: a factory call, or a binding to one. */
  private isPurifier(node: TSESTree.Node): boolean {
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.Identifier) {
      const variable = this.variableOf(inner);
      return variable !== null && this.purifiers.has(variable) && !this.weakenedPurifiers.has(variable);
    }
    return inner.type === AST_NODE_TYPES.CallExpression && this.isPurifierFactory(inner.callee);
  }

  /** True when `node` is the dompurify default export (or namespace), which makes instances. */
  isPurifierFactory(node: TSESTree.Node): boolean {
    const binding = this.moduleOf(node);
    return binding?.module === 'dompurify' && (binding.imported === '*' || binding.imported === 'default');
  }

  private isWeakened(node: TSESTree.Node): boolean {
    const inner = unwrap(node);
    if (inner.type !== AST_NODE_TYPES.Identifier) {
      return false;
    }
    const variable = this.variableOf(inner);
    return variable !== null && this.weakenedPurifiers.has(variable);
  }

  /** The encoder a call invokes, before its options are checked. */
  encoderOf(call: TSESTree.CallExpression): Encoder | null {
    const callee = unwrap(call.callee);
    if (callee.type === AST_NODE_TYPES.Identifier) {
      const binding = this.moduleOf(callee);
      if (binding !== null) {
        const spec = this.specOf(binding);
        if (spec === null) {
          return this.options.sanitizerNames.has(callee.name) ? { encoding: 'escape-quot' } : null;
        }
        if (binding.imported === '*' || binding.imported === 'default') {
          return spec.callable ?? null;
        }
        return spec.named[binding.imported] ?? null;
      }
      const global = GLOBAL_ENCODERS[callee.name];
      if (global !== undefined && this.isGlobal(callee, callee.name)) {
        return { encoding: global };
      }
      return this.options.sanitizerNames.has(callee.name) ? { encoding: 'escape-quot' } : null;
    }
    if (callee.type !== AST_NODE_TYPES.MemberExpression) {
      return null;
    }
    const method = propertyName(callee);
    if (method === null) {
      return null;
    }
    const object = unwrap(callee.object);
    const binding = this.moduleOf(object);
    if (binding !== null && (binding.imported === '*' || binding.imported === 'default')) {
      const spec = this.specOf(binding);
      const encoder = spec?.named[method];
      if (encoder !== undefined) {
        return encoder === DOMPURIFY && this.isWeakened(object) ? null : encoder;
      }
    }
    if (method === 'sanitize' && this.isPurifier(object)) {
      return DOMPURIFY;
    }
    if (object.type === AST_NODE_TYPES.Identifier || object.type === AST_NODE_TYPES.MemberExpression) {
      const text = `${squash(this.sourceCode.getText(object))}.${method}`;
      if (this.options.sanitizerTexts.has(text)) {
        return { encoding: 'escape-quot' };
      }
    }
    return null;
  }

  /** The encoding a call's result has, with options that switch protection off refused. */
  encodingOf(call: TSESTree.CallExpression): Encoding | null {
    const encoder = this.encoderOf(call);
    if (encoder === null) {
      return null;
    }
    if (call.arguments.some((arg) => arg.type === AST_NODE_TYPES.SpreadElement)) {
      return null;
    }
    const safe = encoder.options === undefined ? call.arguments.length <= 1 : encoder.options(call, this);
    return safe ? encoder.encoding : null;
  }

  /* ---- sanitizer options --------------------------------------------- */

  /**
   * The object literal an options argument is, inline or a `const` that is
   * not exported and only ever handed to sanitizer calls, so nothing changes it.
   */
  optionsObject(node: TSESTree.Node | undefined): TSESTree.ObjectExpression | null {
    if (node === undefined) {
      return null;
    }
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.ObjectExpression) {
      return inner;
    }
    if (inner.type !== AST_NODE_TYPES.Identifier) {
      return null;
    }
    const init = this.constInit(inner);
    const variable = this.variableOf(inner);
    if (init === null || variable === null || unwrap(init).type !== AST_NODE_TYPES.ObjectExpression) {
      return null;
    }
    const exported = variable.defs[0]?.parent?.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration;
    const onlyPassed = variable.references.every((reference) => {
      if (reference.init === true) {
        return true;
      }
      const parent = reference.identifier.parent;
      return (
        parent?.type === AST_NODE_TYPES.CallExpression &&
        parent.callee !== reference.identifier &&
        this.encoderOf(parent) !== null
      );
    });
    return !exported && onlyPassed ? (unwrap(init) as TSESTree.ObjectExpression) : null;
  }

  /** Each property of an options object, or null when one is spread or computed. */
  private optionEntries(object: TSESTree.ObjectExpression): Map<string, TSESTree.Node> | null {
    const entries = new Map<string, TSESTree.Node>();
    for (const property of object.properties) {
      if (property.type !== AST_NODE_TYPES.Property) {
        return null;
      }
      const key = propertyKey(property);
      if (key === null) {
        return null;
      }
      entries.set(key, property.value);
    }
    return entries;
  }

  private isFalse(node: TSESTree.Node): boolean {
    const inner = unwrap(node);
    return inner.type === AST_NODE_TYPES.Literal && inner.value === false;
  }

  /** The strings of an array literal of string literals, else null. */
  private stringArray(node: TSESTree.Node): string[] | null {
    const inner = unwrap(node);
    if (inner.type !== AST_NODE_TYPES.ArrayExpression) {
      return null;
    }
    const values: string[] = [];
    for (const element of inner.elements) {
      const text = element === null ? null : staticString(element);
      if (text === null) {
        return null;
      }
      values.push(text);
    }
    return values;
  }

  /** `sanitizeHtml.defaults.<field>` on the sanitize-html binding, optionally `.concat([...literals])`. */
  private isSanitizeHtmlDefault(node: TSESTree.Node, field: string, safeItem: (item: string) => boolean): boolean {
    let inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.CallExpression) {
      const callee = unwrap(inner.callee);
      if (
        callee.type !== AST_NODE_TYPES.MemberExpression ||
        propertyName(callee) !== 'concat' ||
        !inner.arguments.every((arg) => this.stringArray(arg)?.every(safeItem) === true)
      ) {
        return false;
      }
      inner = unwrap(callee.object);
    }
    if (inner.type !== AST_NODE_TYPES.MemberExpression || propertyName(inner) !== field) {
      return false;
    }
    const defaults = unwrap(inner.object);
    return (
      defaults.type === AST_NODE_TYPES.MemberExpression &&
      propertyName(defaults) === 'defaults' &&
      this.moduleOf(defaults.object)?.module === 'sanitize-html'
    );
  }

  private safeAttributeName(name: string): boolean {
    const lower = name.toLowerCase();
    return !lower.startsWith('on') && lower !== 'srcdoc' && lower !== '*';
  }

  /** An attribute map (`{ a: ['href'], '*': ['class'] }`) that allows no event handler or `srcdoc`. */
  private safeAttributeMap(node: TSESTree.Node, tagSafe: (tag: string) => boolean): boolean {
    const object = unwrap(node);
    if (object.type !== AST_NODE_TYPES.ObjectExpression) {
      return false;
    }
    const entries = this.optionEntries(object);
    if (entries === null) {
      return false;
    }
    for (const [tag, value] of entries) {
      if (!tagSafe(tag) && tag !== '*') {
        return false;
      }
      const names = this.stringArray(value);
      if (names === null || !names.every((name) => this.safeAttributeName(name))) {
        return false;
      }
    }
    return true;
  }

  heOptionsSafe(call: TSESTree.CallExpression): boolean {
    if (call.arguments.length <= 1) {
      return true;
    }
    const object = this.optionsObject(call.arguments[1]);
    const entries = object === null ? null : this.optionEntries(object);
    const unsafeSymbols = entries?.get('allowUnsafeSymbols');
    return entries !== null && entries !== undefined && (unsafeSymbols === undefined || this.isFalse(unsafeSymbols));
  }

  serializeOptionsSafe(call: TSESTree.CallExpression): boolean {
    const options = call.arguments[1];
    if (options === undefined) {
      return true;
    }
    const inner = unwrap(options);
    if (inner.type === AST_NODE_TYPES.Literal && typeof inner.value === 'number') {
      return true;
    }
    const object = this.optionsObject(options);
    const entries = object === null ? null : this.optionEntries(object);
    const unsafe = entries?.get('unsafe');
    return entries !== null && entries !== undefined && (unsafe === undefined || this.isFalse(unsafe));
  }

  sanitizeHtmlOptionsSafe(call: TSESTree.CallExpression): boolean {
    if (call.arguments.length <= 1) {
      return true;
    }
    const object = this.optionsObject(call.arguments[1]);
    const entries = object === null ? null : this.optionEntries(object);
    if (entries === null || call.arguments.length > 2) {
      return false;
    }
    const tagSafe = (tag: string): boolean => !DANGEROUS_TAGS.has(tag.toLowerCase());
    const schemeSafe = (scheme: string): boolean => !DANGEROUS_SCHEMES.has(scheme.toLowerCase());
    for (const [key, value] of entries) {
      switch (key) {
        case 'allowedTags':
          if (!(this.stringArray(value)?.every(tagSafe) ?? this.isSanitizeHtmlDefault(value, key, tagSafe))) {
            return false;
          }
          break;
        case 'allowedAttributes':
          if (
            !this.safeAttributeMap(value, tagSafe) &&
            !this.isSanitizeHtmlDefault(value, key, (name) => this.safeAttributeName(name))
          ) {
            return false;
          }
          break;
        case 'allowVulnerableTags':
          if (!this.isFalse(value)) {
            return false;
          }
          break;
        case 'allowedSchemes':
        case 'allowedSchemesAppliedToAttributes':
          if (!(this.stringArray(value)?.every(schemeSafe) ?? this.isSanitizeHtmlDefault(value, key, schemeSafe))) {
            return false;
          }
          break;
        case 'allowedSchemesByTag': {
          const byTag = unwrap(value);
          const tags = byTag.type === AST_NODE_TYPES.ObjectExpression ? this.optionEntries(byTag) : null;
          if (tags === null || ![...tags.values()].every((schemes) => this.stringArray(schemes)?.every(schemeSafe) === true)) {
            return false;
          }
          break;
        }
        // These rewrite tags or text after the filter runs, or decide it.
        case 'transformTags':
        case 'textFilter':
        case 'allowedScriptHostnames':
        case 'allowedScriptDomains':
          return false;
        default:
          break;
      }
    }
    return true;
  }

  xssOptionsSafe(call: TSESTree.CallExpression): boolean {
    if (call.arguments.length <= 1) {
      return true;
    }
    const object = this.optionsObject(call.arguments[1]);
    const entries = object === null ? null : this.optionEntries(object);
    if (entries === null || call.arguments.length > 2) {
      return false;
    }
    const tagSafe = (tag: string): boolean => !DANGEROUS_TAGS.has(tag.toLowerCase()) && tag.toLowerCase() !== 'iframe';
    for (const [key, value] of entries) {
      switch (key) {
        case 'whiteList':
        case 'allowList':
          if (!this.safeAttributeMap(value, tagSafe)) {
            return false;
          }
          break;
        // Callbacks that can write raw HTML or attribute values, and a custom escaper.
        case 'onTag':
        case 'onTagAttr':
        case 'onIgnoreTag':
        case 'onIgnoreTagAttr':
        case 'safeAttrValue':
        case 'escapeHtml':
          return false;
        case 'allowCommentTag':
          if (!this.isFalse(value)) {
            return false;
          }
          break;
        default:
          break;
      }
    }
    return true;
  }

  domPurifyOptionsSafe(call: TSESTree.CallExpression): boolean {
    if (call.arguments.length <= 1) {
      return true;
    }
    return call.arguments.length === 2 && this.domPurifyConfigSafe(call.arguments[1]);
  }

  /** A DOMPurify config that keeps a string result and admits no script. */
  domPurifyConfigSafe(node: TSESTree.Node | undefined): boolean {
    const object = this.optionsObject(node);
    const entries = object === null ? null : this.optionEntries(object);
    if (entries === null) {
      return false;
    }
    const tagSafe = (tag: string): boolean => !DOMPURIFY_DANGEROUS_TAGS.has(tag.toLowerCase());
    for (const [key, value] of entries) {
      switch (key) {
        // A DOM node is not a sanitized string: serializing it again is how mutation XSS gets back in.
        case 'RETURN_DOM':
        case 'RETURN_DOM_FRAGMENT':
        case 'RETURN_DOM_IMPORT':
        case 'IN_PLACE':
        case 'ALLOW_UNKNOWN_PROTOCOLS':
          if (!this.isFalse(value)) {
            return false;
          }
          break;
        case 'SAFE_FOR_XML': {
          const inner = unwrap(value);
          if (!(inner.type === AST_NODE_TYPES.Literal && inner.value === true)) {
            return false;
          }
          break;
        }
        case 'ADD_TAGS':
        case 'ALLOWED_TAGS':
          if (this.stringArray(value)?.every(tagSafe) !== true) {
            return false;
          }
          break;
        case 'ADD_ATTR':
        case 'ALLOWED_ATTR':
          if (this.stringArray(value)?.every((name) => this.safeAttributeName(name)) !== true) {
            return false;
          }
          break;
        case 'ALLOWED_URI_REGEXP':
        case 'CUSTOM_ELEMENT_HANDLING':
          return false;
        default:
          break;
      }
    }
    return true;
  }

  /* ---- `.replace` chains --------------------------------------------- */

  private patternOf(node: TSESTree.Node | undefined, method: string): { info: PatternInfo | null; global: boolean } {
    if (node === undefined || node.type === AST_NODE_TYPES.SpreadElement) {
      return { info: null, global: false };
    }
    let inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.Identifier) {
      // A `const` regex: `replace` with a global regex starts from index 0 whatever `lastIndex` holds.
      const init = this.constInit(inner);
      const regex = init === null ? null : unwrap(init);
      if (regex?.type === AST_NODE_TYPES.Literal && 'regex' in regex && regex.regex !== undefined) {
        inner = regex;
      }
    }
    if (inner.type === AST_NODE_TYPES.Literal && 'regex' in inner && inner.regex !== undefined) {
      const { pattern, flags } = inner.regex;
      return { info: parseRegexPattern(pattern, flags), global: flags.includes('g') && !flags.includes('y') };
    }
    const text = staticString(inner) ?? (inner.type === AST_NODE_TYPES.Identifier ? this.constString(inner) : null);
    if (text === null || text === '') {
      return { info: null, global: false };
    }
    const chars = new Set(text);
    return {
      info: { matchable: chars, covers: text.length === 1 ? chars : new Set() },
      global: method === 'replaceAll',
    };
  }

  private constString(node: TSESTree.Identifier): string | null {
    const init = this.constInit(node);
    return init === null ? null : staticString(init);
  }

  /** True when every use of a `const` object is a computed read (`MAP[c]`), so nothing changes it. */
  private isFrozenTable(node: TSESTree.Identifier): boolean {
    const variable = this.variableOf(node);
    if (variable === null || variable.defs[0]?.parent?.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration) {
      return false;
    }
    return variable.references.every((reference) => {
      if (reference.init === true) {
        return true;
      }
      const parent = reference.identifier.parent;
      if (parent?.type !== AST_NODE_TYPES.MemberExpression || parent.object !== reference.identifier) {
        return false;
      }
      const user = parent.parent;
      return !(
        (user?.type === AST_NODE_TYPES.AssignmentExpression && user.left === parent) ||
        user?.type === AST_NODE_TYPES.UpdateExpression ||
        (user?.type === AST_NODE_TYPES.UnaryExpression && user.operator === 'delete')
      );
    });
  }

  private replacementOf(node: TSESTree.Node | undefined): Replacement {
    if (node === undefined || node.type === AST_NODE_TYPES.SpreadElement) {
      return { kind: 'unknown' };
    }
    const inner = unwrap(node);
    const text = staticString(inner) ?? (inner.type === AST_NODE_TYPES.Identifier ? this.constString(inner) : null);
    if (text !== null) {
      return { kind: 'text', text };
    }
    const fn = this.functionOf(inner);
    const param = fn?.params[0];
    const body = fn === null ? null : returnedExpression(fn);
    if (fn === null || param?.type !== AST_NODE_TYPES.Identifier || body === null) {
      return { kind: 'unknown' };
    }
    const isParam = (candidate: TSESTree.Node): boolean => {
      const id = unwrap(candidate);
      return id.type === AST_NODE_TYPES.Identifier && id.name === param.name && this.variableOf(id)?.defs[0]?.name === param;
    };
    const expression = unwrap(body);
    // `c => MAP[c]` over a literal table of plain strings.
    if (expression.type === AST_NODE_TYPES.MemberExpression && expression.computed && isParam(expression.property)) {
      const table = unwrap(expression.object);
      let object: TSESTree.Node | null = null;
      if (table.type === AST_NODE_TYPES.ObjectExpression) {
        object = table;
      } else if (table.type === AST_NODE_TYPES.Identifier && this.isFrozenTable(table)) {
        object = this.constInit(table);
      }
      const entries = object !== null && unwrap(object).type === AST_NODE_TYPES.ObjectExpression
        ? this.optionEntries(unwrap(object) as TSESTree.ObjectExpression)
        : null;
      if (entries === null) {
        return { kind: 'unknown' };
      }
      const keys = new Set<string>();
      for (const [key, value] of entries) {
        const replacement = staticString(value);
        if (replacement === null || MARKUP.test(replacement)) {
          return { kind: 'unknown' };
        }
        keys.add(key);
      }
      return { kind: 'map', keys };
    }
    // `c => '&#' + c.charCodeAt(0) + ';'` and its template form.
    const texts: string[] = [];
    const parts: TSESTree.Node[] = [];
    const collect = (part: TSESTree.Node): void => {
      const piece = unwrap(part);
      if (piece.type === AST_NODE_TYPES.BinaryExpression && piece.operator === '+') {
        collect(piece.left);
        collect(piece.right);
      } else if (piece.type === AST_NODE_TYPES.TemplateLiteral) {
        piece.quasis.forEach((quasi, index) => {
          texts.push(quasi.value.cooked ?? '<');
          const next = piece.expressions[index];
          if (next !== undefined) {
            collect(next);
          }
        });
      } else if (piece.type === AST_NODE_TYPES.Literal) {
        texts.push(typeof piece.value === 'string' ? piece.value : '<');
      } else {
        parts.push(piece);
      }
    };
    collect(expression);
    const charCodes = parts.every((piece) => {
      if (piece.type !== AST_NODE_TYPES.CallExpression) {
        return false;
      }
      const callee = unwrap(piece.callee);
      return (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        isParam(callee.object) &&
        (propertyName(callee) === 'charCodeAt' || propertyName(callee) === 'codePointAt')
      );
    });
    return parts.length > 0 && charCodes && texts.every((text) => !MARKUP.test(text))
      ? { kind: 'charcode' }
      : { kind: 'unknown' };
  }

  /**
   * True when a `.replace` / `.replaceAll` chain is safe in `context`. Steps
   * run innermost first. A step counts as encoding a character only when it
   * is global (`replaceAll`, or a regex with `g` and no `y`), consumes every
   * occurrence of the character, and writes text with no markup character
   * (an entity, nothing, or a lookup table or char code function that does).
   * A later step that writes a markup character or puts the match back undoes
   * the chain.
   */
  private chainSafeIn(call: TSESTree.CallExpression, context: HtmlContext, sink: TSESTree.Node, depth: number): boolean {
    const steps: TSESTree.CallExpression[] = [];
    let current: TSESTree.Node = call;
    for (let i = 0; i < 16; i += 1) {
      const inner = unwrap(current);
      if (inner.type !== AST_NODE_TYPES.CallExpression) {
        break;
      }
      const callee = unwrap(inner.callee);
      const method = callee.type === AST_NODE_TYPES.MemberExpression ? propertyName(callee) : null;
      if (callee.type !== AST_NODE_TYPES.MemberExpression || (method !== 'replace' && method !== 'replaceAll')) {
        break;
      }
      steps.unshift(inner);
      current = callee.object;
    }
    const base = current;
    const covered = new Set<string>();
    let baseValid = true;
    let restricted = false;
    for (const step of steps) {
      const callee = unwrap(step.callee) as TSESTree.MemberExpression;
      const { info, global } = this.patternOf(step.arguments[0], propertyName(callee) ?? '');
      const replacement = this.replacementOf(step.arguments[1]);
      const reset = (): void => {
        covered.clear();
        baseValid = false;
      };
      if (replacement.kind === 'text' && !substitutes(replacement.text)) {
        if (!MARKUP.test(replacement.text)) {
          if (global && info !== null) {
            for (const char of info.covers) {
              covered.add(char);
            }
          }
          // A reference written or reshaped here may decode to `:` in a URL.
          restricted ||= replacement.text.includes('&') || touchesReferences(info?.matchable ?? null);
        } else if (info !== null && !touchesReferences(info.matchable) && SAFE_MARKUP.test(replacement.text)) {
          // `<br>` for a newline: author markup between escaped text.
          restricted = true;
        } else {
          reset();
        }
      } else if (replacement.kind === 'map' || replacement.kind === 'charcode') {
        if (global && info !== null) {
          for (const char of info.covers) {
            if (replacement.kind === 'charcode' || replacement.keys.has(char)) {
              covered.add(char);
            }
          }
        }
        restricted = true;
      } else {
        reset();
      }
    }
    const chain: Encoding | null = ESCAPE_ALL_CHARS.every((char) => covered.has(char))
      ? 'escape-all'
      : ESCAPE_QUOT_CHARS.every((char) => covered.has(char))
        ? 'escape-quot'
        : null;
    if (restricted && !MARKUP_SAFE.has(context)) {
      return false;
    }
    return (
      (chain !== null && SAFE_IN[chain].has(context)) || (baseValid && this.safeIn(base, context, sink, depth + 1))
    );
  }

  /* ---- constants and guards ------------------------------------------ */

  /** True when the value is a member of request input, directly or through `const` bindings. */
  private isRequestInput(node: TSESTree.Node, depth = 0): boolean {
    if (depth > MAX_DEPTH) {
      return true;
    }
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.MemberExpression) {
      let root: TSESTree.Node = inner;
      let field: string | null = null;
      while (root.type === AST_NODE_TYPES.MemberExpression) {
        field = propertyName(root);
        root = unwrap(root.object);
      }
      if (root.type === AST_NODE_TYPES.Identifier && REQUEST_OBJECTS.has(root.name)) {
        return field !== null && REQUEST_FIELDS.has(field);
      }
      return this.isRequestInput(root, depth + 1);
    }
    if (inner.type !== AST_NODE_TYPES.Identifier) {
      return false;
    }
    const variable = this.variableOf(inner);
    const def = variable?.defs[0];
    if (def?.type === 'Parameter') {
      // A Nest handler parameter bound with `@Body()`, `@Query()` and the like
      // (on the parameter, or on its default-value pattern).
      const holders: TSESTree.Node[] = [def.name];
      if (def.name.parent?.type === AST_NODE_TYPES.AssignmentPattern) {
        holders.push(def.name.parent);
      }
      const decorated = holders.flatMap((holder) =>
        'decorators' in holder && Array.isArray(holder.decorators) ? (holder.decorators as TSESTree.Decorator[]) : [],
      );
      return decorated.some((decorator) => {
        const expression = unwrap(decorator.expression);
        const callee = expression.type === AST_NODE_TYPES.CallExpression ? unwrap(expression.callee) : expression;
        return callee.type === AST_NODE_TYPES.Identifier && REQUEST_DECORATORS.has(callee.name);
      });
    }
    if (def?.type === 'Variable' && def.node.init !== null) {
      return this.isRequestInput(def.node.init, depth + 1);
    }
    return false;
  }

  /** True when the identifier is bound by `for (const x of LIST)` over a literal array nothing changes. */
  private isLiteralLoopBinding(node: TSESTree.Identifier): boolean {
    const variable = this.variableOf(node);
    const def = variable?.defs[0];
    if (variable?.defs.length !== 1 || def?.type !== 'Variable' || def.parent.kind !== 'const') {
      return false;
    }
    const loop = def.parent.parent;
    if (loop?.type !== AST_NODE_TYPES.ForOfStatement || loop.left !== def.parent) {
      return false;
    }
    let list = unwrap(loop.right);
    if (list.type === AST_NODE_TYPES.Identifier) {
      const listVariable = this.variableOf(list);
      const init = this.constInit(list);
      const exported = listVariable?.defs[0]?.parent?.parent?.type === AST_NODE_TYPES.ExportNamedDeclaration;
      const readOnly = listVariable?.references.every((reference) => {
        const parent = reference.identifier.parent;
        if (reference.init === true || (parent?.type === AST_NODE_TYPES.ForOfStatement && parent.right === reference.identifier)) {
          return true;
        }
        return (
          parent?.type === AST_NODE_TYPES.MemberExpression &&
          parent.object === reference.identifier &&
          READ_ONLY_ARRAY_METHODS.has(propertyName(parent) ?? '') &&
          !(parent.parent?.type === AST_NODE_TYPES.AssignmentExpression && parent.parent.left === parent)
        );
      });
      if (init === null || exported || readOnly !== true) {
        return false;
      }
      list = unwrap(init);
    }
    const literalOnly = (element: TSESTree.Node | null): boolean => {
      if (element === null) {
        return true;
      }
      const inner = unwrap(element);
      if (inner.type === AST_NODE_TYPES.ArrayExpression) {
        return inner.elements.every((child) => child?.type !== AST_NODE_TYPES.SpreadElement && literalOnly(child));
      }
      return inner.type === AST_NODE_TYPES.Literal && !('regex' in inner && inner.regex !== undefined);
    };
    return list.type === AST_NODE_TYPES.ArrayExpression && literalOnly(list);
  }

  private isDate(node: TSESTree.Node): boolean {
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.NewExpression) {
      return this.isGlobal(inner.callee, 'Date');
    }
    if (inner.type === AST_NODE_TYPES.Identifier) {
      const init = this.constInit(inner);
      return init !== null && this.isDate(init);
    }
    return false;
  }

  /** A value that is a number, a boolean or author text: safe anywhere. */
  isConstant(node: TSESTree.Node, depth = 0): boolean {
    if (depth > MAX_DEPTH) {
      return false;
    }
    const inner = unwrap(node);
    switch (inner.type) {
      case AST_NODE_TYPES.Literal:
        return true;
      case AST_NODE_TYPES.Identifier:
        return (
          ['undefined', 'NaN', 'Infinity'].some((name) => this.isGlobal(inner, name)) ||
          this.isLiteralLoopBinding(inner)
        );
      case AST_NODE_TYPES.UnaryExpression:
        return ['-', '+', '!', '~', 'typeof', 'void'].includes(inner.operator);
      case AST_NODE_TYPES.BinaryExpression:
        return inner.operator !== '+' || (this.isConstant(inner.left, depth + 1) && this.isConstant(inner.right, depth + 1));
      case AST_NODE_TYPES.UpdateExpression:
        return true;
      case AST_NODE_TYPES.MemberExpression: {
        const name = propertyName(inner);
        return (name === 'length' || name === 'size') && !this.isRequestInput(inner.object);
      }
      case AST_NODE_TYPES.CallExpression: {
        const callee = unwrap(inner.callee);
        if (callee.type === AST_NODE_TYPES.Identifier) {
          return NUMERIC_GLOBALS.has(callee.name) && this.isGlobal(callee, callee.name);
        }
        if (callee.type !== AST_NODE_TYPES.MemberExpression) {
          return false;
        }
        const method = propertyName(callee) ?? '';
        const object = unwrap(callee.object);
        if (this.isGlobal(object, 'Math') || (this.isGlobal(object, 'Number') && method !== 'prototype')) {
          return true;
        }
        if (this.isGlobal(object, 'Date') && method === 'now') {
          return true;
        }
        if (DATE_METHODS.has(method) && this.isDate(object)) {
          return true;
        }
        return NUMERIC_METHODS.has(method);
      }
      default:
        return false;
    }
  }

  /** True when a guard before `sink` proves the value for `context` (`./guards`). */
  private guarded(node: TSESTree.Node, context: HtmlContext, sink: TSESTree.Node): boolean {
    const proven = (guard: GuardContext): boolean => isProvenSafeValue(node, sink, guard, this.sourceCode);
    switch (context) {
      case 'text':
      case 'rcdata':
        return proven('html-text');
      case 'attr-dq':
      case 'attr-sq':
        return proven('html');
      case 'attr-unquoted':
        return proven('shell-word');
      case 'url-dq':
      case 'url-sq':
        return proven('html') && proven('path');
      case 'url-unquoted':
        return proven('shell-word') && proven('path');
      default:
        // A program, a style sheet, a tag: only a literal allowlist or a constant.
        return proven('command');
    }
  }

  /* ---- the verdict --------------------------------------------------- */

  /** True when `node`, written where `context` says, cannot carry markup or script. */
  safeIn(node: TSESTree.Node, context: HtmlContext, sink: TSESTree.Node, depth = 0): boolean {
    if (depth > MAX_DEPTH) {
      return false;
    }
    const inner = unwrap(node);
    if (this.isConstant(inner) || this.guarded(inner, context, sink)) {
      return true;
    }
    switch (inner.type) {
      case AST_NODE_TYPES.ConditionalExpression:
        return this.safeIn(inner.consequent, context, sink, depth + 1) && this.safeIn(inner.alternate, context, sink, depth + 1);
      case AST_NODE_TYPES.LogicalExpression:
        // `a && b` writes `a` only when it is falsy: `false`, `0`, `''`, `null`, `undefined` or `NaN`.
        return (
          (inner.operator === '&&' || this.safeIn(inner.left, context, sink, depth + 1)) &&
          this.safeIn(inner.right, context, sink, depth + 1)
        );
      case AST_NODE_TYPES.TemplateLiteral: {
        // Author text between the parts may not change where they land.
        const plain = context === 'text' || context === 'rcdata' ? /^[^<&]*$/u : /^[^<>"'`&\s]*$/u;
        return (
          inner.quasis.every((quasi) => plain.test(quasi.value.cooked ?? '<')) &&
          inner.expressions.every((expression) => this.safeIn(expression, context, sink, depth + 1))
        );
      }
      case AST_NODE_TYPES.BinaryExpression:
        return (
          inner.operator === '+' &&
          this.safeIn(inner.left, context, sink, depth + 1) &&
          this.safeIn(inner.right, context, sink, depth + 1)
        );
      case AST_NODE_TYPES.Identifier: {
        const init = this.constInit(inner);
        return init !== null && this.safeIn(init, context, sink, depth + 1);
      }
      case AST_NODE_TYPES.CallExpression:
        return this.callSafeIn(inner, context, sink, depth);
      default:
        return false;
    }
  }

  private callSafeIn(call: TSESTree.CallExpression, context: HtmlContext, sink: TSESTree.Node, depth: number): boolean {
    const callee = unwrap(call.callee);
    const [first] = call.arguments;
    if (this.isGlobal(callee, 'String') && call.arguments.length === 1 && first?.type !== AST_NODE_TYPES.SpreadElement && first !== undefined) {
      return this.safeIn(first, context, sink, depth + 1);
    }
    if (callee.type === AST_NODE_TYPES.MemberExpression) {
      const method = propertyName(callee);
      if (method === 'replace' || method === 'replaceAll') {
        return this.chainSafeIn(call, context, sink, depth);
      }
      if (method === 'toString' && call.arguments.length === 0) {
        return this.safeIn(callee.object, context, sink, depth + 1);
      }
    }
    const encoding = this.encodingOf(call);
    if (encoding !== null && SAFE_IN[encoding].has(context)) {
      return true;
    }
    // An in-file helper: judged by what it returns.
    const fn = this.functionOf(callee);
    const returned = fn === null ? null : returnedExpression(fn);
    if (fn === null || returned === null) {
      return false;
    }
    const body = unwrap(returned);
    const index = fn.params.findIndex(
      (param) => param.type === AST_NODE_TYPES.Identifier && body.type === AST_NODE_TYPES.Identifier && param.name === body.name,
    );
    const arg = index === -1 ? undefined : call.arguments[index];
    if (index !== -1) {
      return arg !== undefined && arg.type !== AST_NODE_TYPES.SpreadElement && this.safeIn(arg, context, sink, depth + 1);
    }
    return this.safeIn(returned, context, sink, depth + 1);
  }
}

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}
