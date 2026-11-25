import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import {
  CONTEXT_LABELS,
  contextAt,
  feedText,
  feedValue,
  type HtmlContext,
  type HtmlState,
  START_STATE,
  stateKey,
} from '../html-context';
import {
  encodingSafeIn,
  HtmlSafety,
  isWriteTarget,
  type ModuleBinding,
  propertyKey,
  propertyName,
  returnedExpression,
  staticString,
  unwrap,
} from '../html-safety';

const RULE_NAME = 'no-unescaped-html-response';

export interface NoUnescapedHtmlResponseOptions {
  /** Receivers whose `send` / `end` / `write` write an HTML-capable response body (Express, Node). Replaces the defaults. */
  readonly responseObjects?: readonly string[];
  /**
   * Receivers whose `send` sends a string as `text/plain` unless an HTML
   * content type is set on them (Fastify `reply`). Replaces the defaults.
   */
  readonly replyObjects?: readonly string[];
  /** Receivers whose `body` assignment is the response (Koa `ctx`). Replaces the defaults. */
  readonly contextObjects?: readonly string[];
  /**
   * Escapers trusted to encode `&`, `<`, `>` and `"`. An entry with a dot
   * (`utils.escapeHtml`) matches that callee text when the name it starts
   * from is imported, `require`d or not declared in the file; an entry
   * without one (`escapeHtml`) matches a call by that bare name, never a
   * method. Modules
   * that escape are recognized by their import whatever this says. Replaces
   * the defaults.
   */
  readonly sanitizers?: readonly string[];
}

type RuleOptions = [NoUnescapedHtmlResponseOptions];
type MessageIds = 'unescapedHtmlResponse' | 'unsafeContext' | 'rawTemplateValue';

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
 * Each runtime part is judged where it lands (`../html-context`): element
 * text, a quoted or unquoted attribute, the start of a URL attribute, an event
 * handler, or a script or style element. An escaper is enough only where it
 * is enough (`../html-safety`): `escapeHtml(x)` in `<a href="${...}">` still
 * lets `javascript:` through, and in `<script>` it stops nothing.
 *
 * Sinks: `res.send` / `res.end` / `res.write` (Express, Node), `reply.send`
 * and an async handler's return value with an HTML content type (Fastify),
 * `ctx.body = ...` (Koa), `new Response(body, { headers: { 'content-type':
 * 'text/html' } })` (fetch, Next route handlers), the return value of a Nest
 * route handler (sent as `text/html` on Express unless a header says
 * otherwise), and nunjucks `renderString` / `ejs.render` with a literal
 * template.
 */

export const DEFAULT_RESPONSE_OBJECTS: readonly string[] = ['res', 'response'];
export const DEFAULT_REPLY_OBJECTS: readonly string[] = ['reply'];
export const DEFAULT_CONTEXT_OBJECTS: readonly string[] = ['ctx'];
export const DEFAULT_SANITIZERS: readonly string[] = ['escapeHtml', 'escapeHTML', 'htmlEscape', 'encodeHTML'];

const BODY_WRITERS: ReadonlySet<string> = new Set(['send', 'end', 'write']);
/** Response methods that return the response, so a writer after them is on the response. */
const CHAINABLE: ReadonlySet<string> = new Set([
  'status',
  'code',
  'type',
  'set',
  'header',
  'headers',
  'append',
  'cookie',
  'clearCookie',
  'vary',
  'links',
  'location',
  'contentType',
]);
const HEADER_SETTERS: ReadonlySet<string> = new Set(['set', 'header', 'setHeader', 'headers']);
/** `@nestjs/common` route decorators. */
const NEST_ROUTES: ReadonlySet<string> = new Set(['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Options', 'Head', 'Search']);
const TAG = /<[a-z!/]/iu;
/** Content types a browser renders as markup that can run script. */
const SCRIPTABLE_TYPE = /htm|xml|svg/iu;
const MAX_DEPTH = 8;
const MAX_STATES = 24;
/** String methods: their arguments are not what they return (`q.replace(/\n/g, '<br>')`). */
const STRING_METHODS: ReadonlySet<string> = new Set([
  'at',
  'charAt',
  'endsWith',
  'includes',
  'indexOf',
  'lastIndexOf',
  'localeCompare',
  'match',
  'matchAll',
  'normalize',
  'padEnd',
  'padStart',
  'repeat',
  'replace',
  'replaceAll',
  'search',
  'slice',
  'split',
  'startsWith',
  'substr',
  'substring',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLowerCase',
  'toString',
  'toUpperCase',
  'trim',
  'trimEnd',
  'trimStart',
  'valueOf',
]);
/** Modules whose default export is a DOMPurify instance with shared config. */
const PURIFY_MODULES: ReadonlySet<string> = new Set(['dompurify', 'isomorphic-dompurify']);

const stringArray = (description: string): JSONSchema4 => ({
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description,
});

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    responseObjects: stringArray(
      'Receivers whose `send`, `end` and `write` calls write an HTML-capable response body. Replaces the defaults (`res`, `response`).',
    ),
    replyObjects: stringArray(
      'Receivers whose `send` sends a string as text unless an HTML content type is set on them (Fastify). Replaces the defaults (`reply`).',
    ),
    contextObjects: stringArray('Receivers whose `body` assignment is the response (Koa). Replaces the defaults (`ctx`).'),
    sanitizers: stringArray(
      'Escapers trusted to encode `&`, `<`, `>` and `"`. An entry with a dot matches that callee when the name it starts from is imported, `require`d or not declared in the file; one without matches a call by that bare name, never a method. Replaces the defaults.',
    ),
  },
};

type SourceCode = Readonly<TSESLint.SourceCode>;
type FunctionLike = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression | TSESTree.FunctionDeclaration;

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

function isFunction(node: TSESTree.Node): node is FunctionLike {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionDeclaration
  );
}

function enclosingFunction(node: TSESTree.Node): FunctionLike | TSESTree.Program | null {
  let current = node.parent;
  while (current !== undefined) {
    if (isFunction(current) || current.type === AST_NODE_TYPES.Program) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

/** The receiver with response-returning calls peeled: `res.status(200)` gives `res`. */
function rootReceiver(node: TSESTree.Node): TSESTree.Node {
  let current = unwrap(node);
  while (current.type === AST_NODE_TYPES.CallExpression) {
    const callee = unwrap(current.callee);
    if (callee.type !== AST_NODE_TYPES.MemberExpression || !CHAINABLE.has(propertyName(callee) ?? '')) {
      break;
    }
    current = unwrap(callee.object);
  }
  return current;
}

function receiverText(node: TSESTree.Node, sourceCode: SourceCode): string {
  const root = rootReceiver(node);
  if (root.type === AST_NODE_TYPES.MemberExpression) {
    // `this.res` and `ctx.response` keep their path, without TS wrappers.
    const name = propertyName(root);
    return name === null ? squash(sourceCode.getText(root)) : `${receiverText(root.object, sourceCode)}.${name}`;
  }
  return squash(sourceCode.getText(root));
}

function dedupe(states: readonly HtmlState[]): HtmlState[] {
  const seen = new Map<string, HtmlState>();
  for (const state of states) {
    seen.set(stateKey(state), state);
  }
  if (seen.size > MAX_STATES) {
    // Too many ways to get here: judge what follows as if it were in a tag.
    return [{ mode: 'tag-name', tag: '?', attr: '', value: '' }];
  }
  return [...seen.values()];
}

/** True for a string piece (literal or template text) containing `<`, shallowly through `+`, `?:` and `||`. */
function buildsMarkup(node: TSESTree.Node, depth = 0): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const inner = unwrap(node);
  switch (inner.type) {
    case AST_NODE_TYPES.Literal:
      return typeof inner.value === 'string' && inner.value.includes('<');
    case AST_NODE_TYPES.TemplateLiteral:
      return (
        inner.quasis.some((quasi) => (quasi.value.cooked ?? quasi.value.raw).includes('<')) ||
        inner.expressions.some((expression) => buildsMarkup(expression, depth + 1))
      );
    case AST_NODE_TYPES.TaggedTemplateExpression:
      return buildsMarkup(inner.quasi, depth + 1);
    case AST_NODE_TYPES.BinaryExpression:
      return inner.operator === '+' && (buildsMarkup(inner.left, depth + 1) || buildsMarkup(inner.right, depth + 1));
    case AST_NODE_TYPES.ConditionalExpression:
      return buildsMarkup(inner.consequent, depth + 1) || buildsMarkup(inner.alternate, depth + 1);
    case AST_NODE_TYPES.LogicalExpression:
      return buildsMarkup(inner.left, depth + 1) || buildsMarkup(inner.right, depth + 1);
    case AST_NODE_TYPES.CallExpression: {
      const callee = unwrap(inner.callee);
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return false;
      }
      const method = propertyName(callee);
      return (
        ((method === 'join' || method === 'concat' || method === 'replace' || method === 'replaceAll') &&
          buildsMarkup(callee.object, depth + 1)) ||
        (method === 'concat' &&
          inner.arguments.some((arg) => arg.type !== AST_NODE_TYPES.SpreadElement && buildsMarkup(arg, depth + 1)))
      );
    }
    case AST_NODE_TYPES.ArrayExpression:
      return inner.elements.some(
        (element) => element !== null && element.type !== AST_NODE_TYPES.SpreadElement && buildsMarkup(element, depth + 1),
      );
    default:
      return false;
  }
}

/** Every expression a function returns: its expression body, or each `return` outside nested functions. */
function returnedExpressions(fn: FunctionLike): TSESTree.Node[] {
  if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
    return [fn.body];
  }
  const found: TSESTree.Node[] = [];
  const walk = (node: TSESTree.Node): void => {
    if (isFunction(node) || node.type === AST_NODE_TYPES.ClassBody) {
      return;
    }
    if (node.type === AST_NODE_TYPES.ReturnStatement) {
      if (node.argument !== null) {
        found.push(node.argument);
      }
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'parent') {
        continue;
      }
      for (const item of Array.isArray(child) ? child : [child]) {
        if (item !== null && typeof item === 'object' && typeof (item as { type?: unknown }).type === 'string') {
          walk(item as TSESTree.Node);
        }
      }
    }
  };
  for (const statement of fn.body.body) {
    walk(statement);
  }
  return found;
}

/** The text a `.replace` pattern matches, when it is a string or a regex of plain characters, and whether it is global. */
function literalPattern(node: TSESTree.Node): { text: string; global: boolean } | null {
  const text = staticString(node);
  if (text !== null) {
    return { text, global: false };
  }
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.Literal || !('regex' in inner) || /[^gdsu]/u.test(inner.regex.flags)) {
    return null;
  }
  let plain = '';
  const source = inner.regex.pattern;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char === '\\') {
      const next = source[index + 1] ?? '';
      if (next === '' || /[\da-z]/iu.test(next)) {
        return null;
      }
      plain += next;
      index += 1;
    } else if ('^$.*+?()[]{}|'.includes(char)) {
      return null;
    } else {
      plain += char;
    }
  }
  return { text: plain, global: inner.regex.flags.includes('g') };
}

/** A piece of a template filled by `.replace`: author text, or the value written in place of a placeholder. */
type Segment =
  | { readonly text: string }
  /** `also`: replacements of later calls whose placeholder this value may hold, so they may land here too. */
  | { readonly node: TSESTree.Node; readonly also?: readonly TSESTree.Node[] };
/** Characters `encodeURIComponent` leaves as they are. */
const URI_UNRESERVED = /^[\w.!~*'()-]*$/u;
interface Part {
  readonly node: TSESTree.Node;
  readonly contexts: ReadonlySet<HtmlContext>;
  /** Judged even when the body has no author tag: a value in markup that a call is given. */
  readonly forced: boolean;
  /** For a call the rule cannot read through: the parts read in what it is given. The call is reported only when none of them is. */
  readonly inner?: readonly Part[];
}

/** Where a value lands when a call may put it anywhere in its output, a tag name included. */
const ANYWHERE: HtmlState = { mode: 'tag-name', tag: '?', attr: '', value: '' };

/**
 * Walks the expression a body is built from, author text and runtime parts in
 * order, tracking every HTML state each path through it can reach: through
 * templates and `+`, both sides of `?:` and `||`, `const` bindings that build
 * markup, `let` accumulators (`html += ...`), `String.raw`, array and
 * `.map(...).join(...)` building, and in-file helpers that return markup
 * (their parameters bound to the call's arguments).
 */
class HtmlBuilder {
  readonly parts: Part[] = [];
  text = '';
  /** Author text before the first runtime part on the first path, which decides Koa's content type. */
  leading = '';
  /** True when a runtime part is a React server render, so the body is markup without an author tag. */
  rendered = false;
  private sawDynamic = false;
  /** True while reading what an opaque call is given, whose parts are then forced. */
  private forcing = false;
  private readonly active = new Set<unknown>();
  private readonly bound = new Map<TSESLint.Scope.Variable, TSESTree.Node>();

  constructor(
    private readonly judge: HtmlSafety,
    private readonly sink: TSESTree.Node,
  ) {}

  run(node: TSESTree.Node): void {
    this.visit(node, [START_STATE], 0);
  }

  private feed(states: readonly HtmlState[], text: string): HtmlState[] {
    this.text += text;
    if (!this.sawDynamic) {
      this.leading += text;
    }
    return dedupe(states.map((state) => feedText(state, text)));
  }

  private dynamic(
    node: TSESTree.Node,
    states: readonly HtmlState[],
    opaque?: { readonly forced: boolean; readonly inner: readonly Part[] },
  ): HtmlState[] {
    this.sawDynamic = true;
    if (node.type === AST_NODE_TYPES.CallExpression && this.judge.rendersMarkup(node)) {
      this.rendered = true;
    }
    this.parts.push({
      node,
      contexts: new Set(states.map(contextAt)),
      forced: this.forcing || (opaque?.forced ?? false),
      ...(opaque === undefined ? {} : { inner: opaque.inner }),
    });
    return dedupe(states.map(feedValue));
  }

  /**
   * A call (or tag) the rule cannot prove keeps the markup it is given escaped
   * and in place: a function from elsewhere, or a string method that cuts,
   * pads, decodes or rewrites it. The markup it is given is read where the call
   * stands, to report what is unsafe in it; every other value it is given may
   * land anywhere; and the call itself stays an opaque value, reported when
   * nothing inside it is. `forced` makes the call count without an author tag
   * around it, for a string method whose result is the markup it was called on.
   */
  private opaque(
    call: TSESTree.Node,
    markup: readonly TSESTree.Node[],
    values: readonly TSESTree.Node[],
    states: HtmlState[],
    depth: number,
    forced: boolean,
  ): HtmlState[] {
    const start = this.parts.length;
    const saved = { text: this.text, leading: this.leading, sawDynamic: this.sawDynamic, rendered: this.rendered, forcing: this.forcing };
    this.forcing = true;
    for (const node of markup) {
      this.visit(node, states, depth + 1);
    }
    for (const node of values) {
      this.dynamic(node, [ANYWHERE]);
    }
    this.text = saved.text;
    this.leading = saved.leading;
    this.sawDynamic = saved.sawDynamic;
    this.rendered = saved.rendered;
    this.forcing = saved.forcing;
    return this.dynamic(call, states, { forced, inner: this.parts.slice(start) });
  }

  private visit(node: TSESTree.Node, states: HtmlState[], depth: number): HtmlState[] {
    if (depth > MAX_DEPTH) {
      return this.dynamic(node, states);
    }
    const inner = unwrap(node);
    switch (inner.type) {
      case AST_NODE_TYPES.Literal:
        return this.feed(states, inner.value === null ? 'null' : String(inner.value));
      case AST_NODE_TYPES.TemplateLiteral:
        return this.visitTemplate(inner, states, depth, false);
      case AST_NODE_TYPES.TaggedTemplateExpression: {
        const tag = unwrap(inner.tag);
        if (
          tag.type === AST_NODE_TYPES.MemberExpression &&
          propertyName(tag) === 'raw' &&
          this.judge.isGlobal(unwrap(tag.object), 'String')
        ) {
          return this.visitTemplate(inner.quasi, states, depth, true);
        }
        // A tag from elsewhere (`dedent`, common-tags `html`) is opaque; an escaping module, or a tag
        // function of this file, stays a value.
        if (!this.judge.isEscapingModule(tag) && this.judge.functionOf(tag) === null) {
          return this.opaque(inner, [inner.quasi], [], states, depth, false);
        }
        return this.dynamic(inner, states);
      }
      case AST_NODE_TYPES.BinaryExpression:
        if (inner.operator !== '+') {
          return this.dynamic(inner, states);
        }
        return this.visit(inner.right, this.visit(inner.left, states, depth + 1), depth + 1);
      case AST_NODE_TYPES.ConditionalExpression:
        return dedupe([
          ...this.visit(inner.consequent, states, depth + 1),
          ...this.visit(inner.alternate, states, depth + 1),
        ]);
      case AST_NODE_TYPES.LogicalExpression:
        // `a && b` writes `a` only when it is falsy (`false`, `0`, `''`, `null`), which is plain text.
        return dedupe([
          ...(inner.operator === '&&' ? states : this.visit(inner.left, states, depth + 1)),
          ...this.visit(inner.right, states, depth + 1),
        ]);
      case AST_NODE_TYPES.Identifier:
        return this.visitIdentifier(inner, states, depth);
      case AST_NODE_TYPES.CallExpression:
        return this.visitCall(inner, states, depth);
      default:
        return this.dynamic(inner, states);
    }
  }

  private visitTemplate(
    template: TSESTree.TemplateLiteral,
    states: HtmlState[],
    depth: number,
    raw: boolean,
  ): HtmlState[] {
    let current = states;
    template.quasis.forEach((quasi, index) => {
      current = this.feed(current, raw ? quasi.value.raw : (quasi.value.cooked ?? quasi.value.raw));
      const expression = template.expressions[index];
      if (expression !== undefined) {
        current = this.visit(expression, current, depth + 1);
      }
    });
    return current;
  }

  private visitIdentifier(node: TSESTree.Identifier, states: HtmlState[], depth: number): HtmlState[] {
    const variable = this.judge.variableOf(node);
    if (variable !== null && this.active.has(variable)) {
      // The accumulator read in its own update (`html = html + x`): its text so far.
      return states;
    }
    const argument = variable === null ? undefined : this.bound.get(variable);
    if (argument !== undefined && variable !== null) {
      // A helper's parameter: the call's argument, written here.
      this.bound.delete(variable);
      const result = this.visit(argument, states, depth + 1);
      this.bound.set(variable, argument);
      return result;
    }
    const init = this.judge.constInit(node);
    // Constant text is author text too: a quote in it opens a string in a script.
    if (init !== null && (buildsMarkup(init) || this.constantText(init, depth)) && variable !== null) {
      this.active.add(variable);
      const result = this.visit(init, states, depth + 1);
      this.active.delete(variable);
      return result;
    }
    const writes = variable === null ? null : this.accumulatorWrites(variable);
    if (writes === null || variable === null) {
      return this.dynamic(node, states);
    }
    this.active.add(variable);
    let current = states;
    for (const write of writes) {
      if (write.type === AST_NODE_TYPES.VariableDeclarator) {
        current = write.init === null ? current : this.visit(write.init, current, depth + 1);
      } else if (write.operator === '+=') {
        current = this.visit(write.right, current, depth + 1);
      } else if (this.startsWithSelf(write.right, variable)) {
        current = this.visit(write.right, current, depth + 1);
      } else {
        // A fresh value: it may replace what was built, or only in some branch.
        current = dedupe([...current, ...this.visit(write.right, states, depth + 1)]);
      }
    }
    this.active.delete(variable);
    return current;
  }

  /** True for a string or number built only from literals and `const` text, through `+` and templates. */
  private constantText(node: TSESTree.Node, depth: number): boolean {
    if (depth > MAX_DEPTH) {
      return false;
    }
    const inner = unwrap(node);
    switch (inner.type) {
      case AST_NODE_TYPES.Literal:
        return typeof inner.value === 'string' || typeof inner.value === 'number';
      case AST_NODE_TYPES.TemplateLiteral:
        return inner.expressions.every((expression) => this.constantText(expression, depth + 1));
      case AST_NODE_TYPES.BinaryExpression:
        return (
          inner.operator === '+' &&
          this.constantText(inner.left, depth + 1) &&
          this.constantText(inner.right, depth + 1)
        );
      case AST_NODE_TYPES.Identifier: {
        const init = this.judge.constInit(inner);
        return init !== null && this.constantText(init, depth + 1);
      }
      default:
        return false;
    }
  }

  /** The text of a string or number built only from literals and `const` text, else null. */
  private constantString(node: TSESTree.Node, depth: number): string | null {
    if (depth > MAX_DEPTH) {
      return null;
    }
    const inner = unwrap(node);
    switch (inner.type) {
      case AST_NODE_TYPES.Literal:
        return typeof inner.value === 'string' || typeof inner.value === 'number' ? String(inner.value) : null;
      case AST_NODE_TYPES.TemplateLiteral: {
        let text = '';
        for (const [index, quasi] of inner.quasis.entries()) {
          text += quasi.value.cooked ?? quasi.value.raw;
          const expression = inner.expressions[index];
          const part = expression === undefined ? '' : this.constantString(expression, depth + 1);
          if (part === null) {
            return null;
          }
          text += part;
        }
        return text;
      }
      case AST_NODE_TYPES.BinaryExpression: {
        if (inner.operator !== '+') {
          return null;
        }
        const left = this.constantString(inner.left, depth + 1);
        const right = left === null ? null : this.constantString(inner.right, depth + 1);
        return left === null || right === null ? null : left + right;
      }
      case AST_NODE_TYPES.Identifier: {
        const init = this.judge.constInit(inner);
        return init === null ? null : this.constantString(init, depth + 1);
      }
      default:
        return null;
    }
  }

  /** True for a node that builds markup, directly, through a `const` or through string methods called on it. */
  private carriesMarkup(node: TSESTree.Node, depth = 0): boolean {
    const inner = unwrap(node);
    if (depth > MAX_DEPTH) {
      return false;
    }
    if (inner.type === AST_NODE_TYPES.Identifier) {
      const init = this.judge.constInit(inner);
      return init !== null && this.carriesMarkup(init, depth + 1);
    }
    if (inner.type === AST_NODE_TYPES.CallExpression) {
      const callee = unwrap(inner.callee);
      const method = callee.type === AST_NODE_TYPES.MemberExpression ? propertyName(callee) : null;
      if (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        (STRING_METHODS.has(method ?? '') || method === 'concat') &&
        this.carriesMarkup(callee.object, depth + 1)
      ) {
        return true;
      }
    }
    return buildsMarkup(inner);
  }

  /**
   * A constant template filled by `.replace` / `.replaceAll` calls
   * (`tpl.replace('{{name}}', q)`), split at each placeholder a string or a
   * plain regex pattern matches: the first one, or all for a global replace.
   */
  private replaceSegments(call: TSESTree.CallExpression, depth: number): Segment[] | null {
    const callee = unwrap(call.callee);
    const method = callee.type === AST_NODE_TYPES.MemberExpression ? propertyName(callee) : null;
    const [patternNode, replacement] = call.arguments;
    if (
      depth > MAX_DEPTH ||
      callee.type !== AST_NODE_TYPES.MemberExpression ||
      (method !== 'replace' && method !== 'replaceAll') ||
      call.arguments.length !== 2 ||
      patternNode === undefined ||
      replacement === undefined ||
      patternNode.type === AST_NODE_TYPES.SpreadElement ||
      replacement.type === AST_NODE_TYPES.SpreadElement ||
      !this.writtenAsIs(replacement)
    ) {
      return null;
    }
    const object = unwrap(callee.object);
    const text = this.constantString(object, 0);
    const base: Segment[] | null =
      text !== null
        ? [{ text }]
        : object.type === AST_NODE_TYPES.CallExpression
          ? this.replaceSegments(object, depth + 1)
          : null;
    const pattern = literalPattern(patternNode);
    if (base === null || pattern === null || pattern.text === '') {
      return null;
    }
    const global = method === 'replaceAll' || pattern.global;
    const segments: Segment[] = [];
    let done = false;
    for (const segment of base) {
      if (!('text' in segment)) {
        // An earlier value may hold the placeholder, and a first match there takes the replacement.
        segments.push(
          !done && this.mayHold(segment.node, pattern.text)
            ? { node: segment.node, also: [...(segment.also ?? []), replacement] }
            : segment,
        );
        continue;
      }
      if (done) {
        segments.push(segment);
        continue;
      }
      let pieces = segment.text.split(pattern.text);
      if (!global && pieces.length > 1) {
        pieces = [pieces[0] ?? '', pieces.slice(1).join(pattern.text)];
        done = true;
      }
      pieces.forEach((piece, index) => {
        if (index > 0) {
          segments.push({ node: replacement });
        }
        segments.push({ text: piece });
      });
    }
    return segments;
  }

  /**
   * True for a replacement `.replace` writes as it is: a replacer function of
   * this file, whose result is never read for `$` patterns, or text that
   * cannot hold a `$` (a constant without one, a number, `encodeURIComponent`
   * output). In a string, `` $` ``, `$'` and `$&` copy author text into the
   * value's place, and `escapeHtml` leaves them alone.
   */
  private writtenAsIs(replacement: TSESTree.Node): boolean {
    if (this.judge.functionOf(replacement) !== null) {
      return true;
    }
    const inner = unwrap(replacement);
    const text = this.constantString(inner, 0);
    if (text !== null) {
      return !text.includes('$');
    }
    if (inner.type === AST_NODE_TYPES.Literal) {
      return typeof inner.value === 'number';
    }
    return inner.type === AST_NODE_TYPES.CallExpression && this.judge.isGlobal(unwrap(inner.callee), 'encodeURIComponent');
  }

  /** False when a value cannot contain `pattern`: a number, a constant without it, or URI-encoded text it does not fit. */
  private mayHold(node: TSESTree.Node, pattern: string): boolean {
    const inner = unwrap(node);
    if (inner.type === AST_NODE_TYPES.Literal && typeof inner.value === 'number') {
      return false;
    }
    const text = this.constantString(inner, 0);
    if (text !== null) {
      return text.includes(pattern);
    }
    return !(
      inner.type === AST_NODE_TYPES.CallExpression &&
      this.judge.isGlobal(unwrap(inner.callee), 'encodeURIComponent') &&
      !URI_UNRESERVED.test(pattern)
    );
  }

  /** A `.replace` replacement: a value, or what a replacer function returns. */
  private visitReplacement(node: TSESTree.Node, states: HtmlState[], depth: number): HtmlState[] {
    const fn = this.judge.functionOf(node);
    if (fn === null) {
      return this.visit(node, states, depth + 1);
    }
    const bodies = returnedExpressions(fn);
    if (bodies.length === 0) {
      return this.dynamic(node, states);
    }
    return dedupe(bodies.flatMap((body) => this.visit(body, states, depth + 1)));
  }

  /**
   * The pieces an array accumulator holds: its literal elements and every
   * `push` / `unshift` argument. Null when the array is used any other way
   * than those calls, `join` and `length`, so it may hold anything.
   */
  private arrayPieces(list: TSESTree.Identifier): TSESTree.Node[] | null {
    const variable = this.judge.variableOf(list);
    const def = variable?.defs[0];
    if (
      variable === null ||
      variable.defs.length !== 1 ||
      def?.type !== 'Variable' ||
      def.node.id.type !== AST_NODE_TYPES.Identifier ||
      def.node.init === null
    ) {
      return null;
    }
    const init = unwrap(def.node.init);
    if (init.type !== AST_NODE_TYPES.ArrayExpression) {
      return null;
    }
    const pieces: TSESTree.Node[] = [];
    for (const element of init.elements) {
      if (element !== null) {
        pieces.push(element.type === AST_NODE_TYPES.SpreadElement ? element.argument : element);
      }
    }
    for (const reference of variable.references) {
      if (reference.init === true) {
        continue;
      }
      const parent = reference.identifier.parent;
      const method = parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === reference.identifier ? propertyName(parent) : null;
      if (method === 'length' || method === 'join') {
        continue;
      }
      const call = parent?.parent;
      if ((method !== 'push' && method !== 'unshift') || call?.type !== AST_NODE_TYPES.CallExpression || call.callee !== parent) {
        return null;
      }
      for (const arg of call.arguments) {
        pieces.push(arg.type === AST_NODE_TYPES.SpreadElement ? arg.argument : arg);
      }
    }
    return pieces;
  }

  /** Pieces repeated any number of times in any order, each followed by `separator`. */
  private visitRepeated(
    pieces: readonly TSESTree.Node[],
    states: HtmlState[],
    separator: string,
    depth: number,
  ): HtmlState[] {
    let all = dedupe(states);
    let current = all;
    for (let round = 0; round < 3 && pieces.length > 0; round += 1) {
      const next = this.feed(
        dedupe(pieces.flatMap((piece) => this.visit(piece, current, depth + 1))),
        separator,
      );
      const merged = dedupe([...all, ...next]);
      if (merged.length === all.length) {
        break;
      }
      all = merged;
      current = next;
    }
    return all;
  }
  private startsWithSelf(node: TSESTree.Node, variable: TSESLint.Scope.Variable): boolean {
    let inner = unwrap(node);
    while (inner.type === AST_NODE_TYPES.BinaryExpression && inner.operator === '+') {
      inner = unwrap(inner.left);
    }
    if (inner.type === AST_NODE_TYPES.TemplateLiteral && inner.quasis[0]?.value.cooked === '') {
      const first = inner.expressions[0];
      inner = first === undefined ? inner : unwrap(first);
    }
    return inner.type === AST_NODE_TYPES.Identifier && this.judge.variableOf(inner) === variable;
  }

  /**
   * The writes that build a `let` / `var` string before the sink, in source
   * order: its initializer, `=` and `+=`. Null when it is written any other
   * way (destructuring, `++`, a loop binding) or is a parameter.
   */
  private accumulatorWrites(
    variable: TSESLint.Scope.Variable,
  ): (TSESTree.VariableDeclarator | TSESTree.AssignmentExpression)[] | null {
    const def = variable.defs[0];
    if (
      variable.defs.length !== 1 ||
      def?.type !== 'Variable' ||
      def.parent.kind === 'const' ||
      def.node.id.type !== AST_NODE_TYPES.Identifier ||
      def.parent.parent?.type === AST_NODE_TYPES.ForOfStatement ||
      def.parent.parent?.type === AST_NODE_TYPES.ForInStatement
    ) {
      return null;
    }
    const writes: (TSESTree.VariableDeclarator | TSESTree.AssignmentExpression)[] = [def.node];
    for (const reference of variable.references) {
      if (!reference.isWrite() || reference.init === true) {
        continue;
      }
      const parent = reference.identifier.parent;
      if (
        parent?.type !== AST_NODE_TYPES.AssignmentExpression ||
        parent.left !== reference.identifier ||
        (parent.operator !== '=' && parent.operator !== '+=')
      ) {
        return null;
      }
      if (parent.range[1] <= this.sink.range[0]) {
        writes.push(parent);
      }
    }
    return writes.sort((a, b) => a.range[0] - b.range[0]);
  }

  private visitCall(call: TSESTree.CallExpression, states: HtmlState[], depth: number): HtmlState[] {
    const callee = unwrap(call.callee);
    if (callee.type === AST_NODE_TYPES.MemberExpression && propertyName(callee) === 'join' && call.arguments.length <= 1) {
      const joined = this.visitJoin(call, callee, states, depth);
      if (joined !== null) {
        return joined;
      }
    }
    if (callee.type === AST_NODE_TYPES.MemberExpression) {
      const method = propertyName(callee);
      if (method === 'replace' || method === 'replaceAll') {
        const segments = this.replaceSegments(call, 0);
        if (segments !== null) {
          let current = states;
          for (const segment of segments) {
            if ('text' in segment) {
              current = this.feed(current, segment.text);
              continue;
            }
            for (const other of segment.also ?? []) {
              this.visitReplacement(other, current, depth);
            }
            current = this.visitReplacement(segment.node, current, depth);
          }
          return current;
        }
      }
      if (method === 'concat' && [callee.object, ...call.arguments].some((node) => this.carriesMarkup(node))) {
        let current = this.visit(callee.object, states, depth + 1);
        for (const arg of call.arguments) {
          current = arg.type === AST_NODE_TYPES.SpreadElement ? this.dynamic(arg.argument, current) : this.visit(arg, current, depth + 1);
        }
        return current;
      }
    }
    const fn = this.judge.functionOf(callee);
    if (fn !== null) {
      const returned = returnedExpression(fn);
      const bodies = returned === null ? returnedExpressions(fn) : [returned];
      if (this.active.has(fn) || !bodies.some((body) => buildsMarkup(body))) {
        return this.dynamic(call, states);
      }
      // A helper that returns markup: its parameters, unless written in it, are the call's arguments.
      const bound: TSESLint.Scope.Variable[] = [];
      fn.params.forEach((param, index) => {
        const argument = call.arguments[index];
        if (param.type === AST_NODE_TYPES.Identifier && argument !== undefined && argument.type !== AST_NODE_TYPES.SpreadElement) {
          const variable = this.judge.variableOf(param);
          if (variable !== null && !variable.references.some((reference) => reference.isWrite())) {
            this.bound.set(variable, argument);
            bound.push(variable);
          }
        }
      });
      this.active.add(fn);
      const result = dedupe(bodies.flatMap((body) => this.visit(body, states, depth + 1)));
      this.active.delete(fn);
      for (const variable of bound) {
        this.bound.delete(variable);
      }
      return result;
    }
    // An escaper or sanitizer is judged as a value.
    if (this.judge.encoderOf(call) !== null || this.judge.isEscapingModule(callee)) {
      return this.dynamic(call, states);
    }
    const args = call.arguments.map((arg) => (arg.type === AST_NODE_TYPES.SpreadElement ? arg.argument : arg));
    // A method called on markup (`page.slice(9)`, `page.padStart(n, x)`) returns text cut,
    // padded or rewritten from it, which the rule does not follow.
    if (callee.type === AST_NODE_TYPES.MemberExpression && this.carriesMarkup(callee.object)) {
      return this.opaque(call, [callee.object], args, states, depth, true);
    }
    if (callee.type === AST_NODE_TYPES.MemberExpression && STRING_METHODS.has(propertyName(callee) ?? '')) {
      return this.dynamic(call, states);
    }
    // A call from elsewhere (``layout(`<h1>${q}</h1>`)``) given markup: the markup is read, the call is not.
    const markup = args.filter((arg) => this.carriesMarkup(arg));
    if (markup.length > 0) {
      return this.opaque(call, markup, args.filter((arg) => !markup.includes(arg)), states, depth, false);
    }
    return this.dynamic(call, states);
  }

  /** `[a, b].join(sep)` and `list.map(fn).join(sep)`, the mapped markup repeated any number of times. */
  private visitJoin(
    call: TSESTree.CallExpression,
    callee: TSESTree.MemberExpression,
    states: HtmlState[],
    depth: number,
  ): HtmlState[] | null {
    const [separatorNode] = call.arguments;
    const separator = separatorNode === undefined ? ',' : staticString(separatorNode);
    if (separator === null) {
      return null;
    }
    let list = unwrap(callee.object);
    if (list.type === AST_NODE_TYPES.Identifier) {
      const init = this.judge.constInit(list);
      if (init !== null && unwrap(init).type === AST_NODE_TYPES.CallExpression) {
        list = unwrap(init);
      } else {
        const pieces = this.arrayPieces(list);
        return pieces === null ? null : this.visitRepeated(pieces, states, separator, depth);
      }
    }
    if (list.type === AST_NODE_TYPES.ArrayExpression) {
      let current = states;
      list.elements.forEach((element, index) => {
        if (index > 0) {
          current = this.feed(current, separator);
        }
        if (element !== null) {
          current =
            element.type === AST_NODE_TYPES.SpreadElement
              ? this.dynamic(element.argument, current)
              : this.visit(element, current, depth + 1);
        }
      });
      return current;
    }
    if (list.type !== AST_NODE_TYPES.CallExpression) {
      return null;
    }
    const mapCallee = unwrap(list.callee);
    const mapper = list.arguments[0];
    const fn = mapper === undefined || mapper.type === AST_NODE_TYPES.SpreadElement ? null : this.judge.functionOf(mapper);
    const bodies = fn === null ? [] : returnedExpressions(fn);
    if (mapCallee.type !== AST_NODE_TYPES.MemberExpression || propertyName(mapCallee) !== 'map' || bodies.length === 0) {
      return null;
    }
    return this.visitRepeated(bodies, states, separator, depth);
  }
}

/** One output of a literal template: the value path it prints, whether raw, and where it lands. */
interface TemplateOutput {
  readonly path: readonly string[];
  readonly raw: boolean;
  readonly contexts: ReadonlySet<HtmlContext>;
}

const PATH_HEAD = /^\s*([A-Za-z_$][\w$]*)/u;
const PATH_STEP = /^\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(?:"([^"\\]*)"|'([^'\\]*)')\s*\])/u;

/** A value path at the start of a template expression (`user.bio`, `locals["bio"]`), and the text after it. */
function readPath(expression: string): { path: string[]; rest: string } | null {
  const head = PATH_HEAD.exec(expression);
  if (head?.[1] === undefined) {
    return null;
  }
  const path = [head[1]];
  let rest = expression.slice(head[0].length);
  for (let step = PATH_STEP.exec(rest); step !== null; step = PATH_STEP.exec(rest)) {
    path.push(step[1] ?? step[2] ?? step[3] ?? '');
    rest = rest.slice(step[0].length);
  }
  return { path, rest: rest.trimStart() };
}

/** A nunjucks output expression: its value path and whether its filters mark it safe or escape it. */
interface NunjucksValue {
  readonly path: readonly string[];
  /** A `safe` or escaping filter made it a safe string, which autoescape leaves alone. */
  readonly marked: boolean;
  readonly escaped: boolean;
}

function readNunjucksValue(expression: string): NunjucksValue | null {
  const output = readPath(expression);
  // A value path, then anything (`[0]`, `~ other`) up to the filters.
  const [head = '', ...filters] = (output?.rest ?? '').split('|');
  if (output === null || head.trimStart().startsWith('(')) {
    return null;
  }
  let marked = false;
  let escaped = false;
  for (const filter of filters.map((part) => part.trim().replace(/\(.*$/u, ''))) {
    if (filter === 'safe') {
      marked = true;
    } else if ((filter === 'escape' || filter === 'e') && !marked) {
      escaped = true;
      marked = true;
    } else if (filter === 'forceescape') {
      escaped = true;
      marked = true;
    }
  }
  return { path: output.path, marked, escaped };
}

/**
 * The outputs of a nunjucks template, with `{% autoescape %}` blocks, the
 * `safe` / `escape` filters and `{% set name = value %}` aliases read.
 */
function nunjucksOutputs(template: string, autoescape: boolean): TemplateOutput[] {
  const outputs: TemplateOutput[] = [];
  const escaping: boolean[] = [autoescape];
  const aliases = new Map<string, NunjucksValue>();
  let state = START_STATE;
  let last = 0;
  for (const match of template.matchAll(/\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}|\{#[\s\S]*?#\}/gu)) {
    state = feedText(state, template.slice(last, match.index));
    last = match.index + match[0].length;
    const tag = match[2];
    if (tag !== undefined) {
      const block = /^\s*(autoescape|endautoescape)\b\s*(\S*)/u.exec(tag);
      const set = /^\s*set\s+([A-Za-z_$][\w$]*)\s*=([\s\S]*)$/u.exec(tag);
      if (block?.[1] === 'autoescape') {
        // Anything but a literal `true` may switch escaping off.
        escaping.push(block[2] === 'true');
      } else if (block?.[1] === 'endautoescape' && escaping.length > 1) {
        escaping.pop();
      } else if (set?.[1] !== undefined) {
        const value = readNunjucksValue(set[2] ?? '');
        if (value === null) {
          aliases.delete(set[1]);
        } else {
          const alias = aliases.get(value.path[0] ?? '');
          aliases.set(set[1], alias === undefined ? value : { ...alias, path: [...alias.path, ...value.path.slice(1)] });
        }
      }
      continue;
    }
    const expression = match[1];
    if (expression === undefined) {
      continue;
    }
    const value = readNunjucksValue(expression);
    if (value !== null) {
      const alias = aliases.get(value.path[0] ?? '');
      // An alias of a safe string stays one, unless this output adds its own filters.
      const marks = alias !== undefined && !value.marked ? alias : value;
      outputs.push({
        path: alias === undefined ? value.path : [...alias.path, ...value.path.slice(1)],
        raw: !marks.escaped && (marks.marked || escaping.at(-1) !== true),
        contexts: new Set([contextAt(state)]),
      });
    }
    state = feedValue(state);
  }
  return outputs;
}
/** How an EJS render reads its template: the tag delimiters, whether `<%=` escapes, and the locals name. */
interface EjsSettings {
  readonly open: string;
  readonly close: string;
  readonly delimiter: string;
  readonly escapes: boolean;
  readonly localsName: string;
}

const EJS_DEFAULTS: EjsSettings = { open: '<', close: '>', delimiter: '%', escapes: true, localsName: 'locals' };
/** EJS options that change neither the tags nor the escaping of a literal template. */
const EJS_NEUTRAL_OPTIONS: ReadonlySet<string> = new Set([
  'cache',
  'filename',
  'root',
  'views',
  'context',
  'scope',
  'compileDebug',
  'debug',
  'strict',
  '_with',
  'rmWhitespace',
  'async',
  'destructuredLocals',
]);

/** EJS options a render also reads from the data object when no options are passed. */
const EJS_DATA_OPTIONS: ReadonlySet<string> = new Set([
  'delimiter',
  'scope',
  'context',
  'debug',
  'compileDebug',
  'client',
  '_with',
  'rmWhitespace',
  'strict',
  'filename',
  'async',
]);
/** EJS options with a text value the rule reads, and the setting each fills. */
const EJS_TEXT_OPTIONS: ReadonlyMap<string, 'delimiter' | 'open' | 'close' | 'localsName'> = new Map([
  ['delimiter', 'delimiter'],
  ['openDelimiter', 'open'],
  ['closeDelimiter', 'close'],
  ['localsName', 'localsName'],
]);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/gu, '\\$&');
}

/** The outputs of an EJS template: `<%=` escaped (unless `escape` is replaced), `<%-` raw. */
function ejsOutputs(template: string, settings: EjsSettings): TemplateOutput[] {
  const outputs: TemplateOutput[] = [];
  const open = settings.open + settings.delimiter;
  const literal = open + settings.delimiter;
  const tags = new RegExp(
    `${escapeRegex(literal)}|${escapeRegex(open)}([=\\-_#]?)([\\s\\S]*?)[-_]?${escapeRegex(settings.delimiter + settings.close)}`,
    'gu',
  );
  let state = START_STATE;
  let last = 0;
  for (const match of template.matchAll(tags)) {
    state = feedText(state, template.slice(last, match.index));
    last = match.index + match[0].length;
    const kind = match[1];
    if (match[0] === literal) {
      // A literal `<%`.
      state = feedText(state, open);
      continue;
    }
    if (kind !== '=' && kind !== '-') {
      continue;
    }
    const path = readPath(match[2] ?? '');
    if (path !== null && !path.rest.startsWith('(')) {
      const segments = path.path;
      outputs.push({
        path: segments[0] === settings.localsName && segments.length > 1 ? segments.slice(1) : segments,
        raw: kind === '-' || !settings.escapes,
        contexts: new Set([contextAt(state)]),
      });
    }
    state = feedValue(state);
  }
  return outputs;
}

/** Every top-level value of a context object, as raw output in element text: for a template the rule cannot read. */
function everyValueRaw(object: TSESTree.ObjectExpression): TemplateOutput[] {
  return object.properties.flatMap((property) => {
    const key = property.type === AST_NODE_TYPES.Property ? propertyKey(property) : null;
    return key === null ? [] : [{ path: [key], raw: true, contexts: new Set<HtmlContext>(['text']) }];
  });
}

interface WriteSink {
  readonly kind: 'write' | 'reply' | 'koa' | 'plain';
  readonly node: TSESTree.Node;
  readonly body: TSESTree.Node;
  readonly receiver: string;
}

export const noUnescapedHtmlResponseRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'HTML built from a runtime value and sent as a response (`res.send`, `ctx.body`, `new Response`, ...), or bound to a raw template variable (`| safe`, `<%-`), must escape or sanitize the value for where it lands: unescaped, it is server-side XSS.',
      cwe: ['CWE-79'],
      owasp: ['A03:2021'],
      securitySeverity: 6.1,
    },
    schema: [optionSchema],
    messages: {
      unescapedHtmlResponse:
        '`{{value}}` is written into an HTML response without escaping, so markup in it runs in the browser (XSS). Escape it (`escapeHtml(value)`), sanitize it, or send JSON with `res.json`.',
      unsafeContext:
        '`{{value}}` is safe in HTML text but lands in {{where}} (XSS). Use an encoder made for that place, check it against a literal allowlist, or move it into element text or a quoted attribute.',
      rawTemplateValue:
        '`{{key}}` is marked raw in the template, so `{{value}}` is rendered without escaping (XSS). Drop the raw marker and let the engine escape it, or sanitize the value first.',
    },
  },
  defaultOptions: [
    {
      responseObjects: DEFAULT_RESPONSE_OBJECTS,
      replyObjects: DEFAULT_REPLY_OBJECTS,
      contextObjects: DEFAULT_CONTEXT_OBJECTS,
      sanitizers: DEFAULT_SANITIZERS,
    },
  ],
  create(context, [options]) {
    const { sourceCode } = context;
    const responseObjects = new Set((options.responseObjects ?? DEFAULT_RESPONSE_OBJECTS).map(squash));
    const replyObjects = new Set((options.replyObjects ?? DEFAULT_REPLY_OBJECTS).map(squash));
    const contextObjects = new Set((options.contextObjects ?? DEFAULT_CONTEXT_OBJECTS).map(squash));
    const entries = (options.sanitizers ?? DEFAULT_SANITIZERS).map((entry) => squash(entry).replace(/\(\)$/u, ''));
    const judge = new HtmlSafety(sourceCode, {
      sanitizerNames: new Set(entries.filter((entry) => !entry.includes('.'))),
      sanitizerTexts: new Set(entries.filter((entry) => entry.includes('.'))),
    });

    const sinks: WriteSink[] = [];
    const templateCalls: TSESTree.CallExpression[] = [];
    const factoryDeclarators: TSESTree.VariableDeclarator[] = [];
    const purifierConfigs: TSESTree.CallExpression[] = [];
    let nunjucksRawEverywhere = false;
    /** Nodes that may change the `ejs` module's settings: assignment targets and call arguments. */
    const ejsWrites: TSESTree.Node[] = [];
    let ejsChanged = false;
    const reported = new Set<string>();

    const report = (node: TSESTree.Node, messageId: MessageIds, data: Record<string, string>): void => {
      const key = `${node.range[0]}:${node.range[1]}:${messageId}`;
      if (!reported.has(key)) {
        reported.add(key);
        context.report({ node, messageId, data });
      }
    };

    const bindModule = (identifier: TSESTree.Node, module: string, imported: string): void => {
      if (identifier.type !== AST_NODE_TYPES.Identifier) {
        return;
      }
      const variable = judge.variableOf(identifier);
      if (variable !== null) {
        judge.bindings.set(variable, { module, imported });
      }
    };

    /** The module and export a `require(...)` (or `require(...).name`) reads. */
    const requiredModule = (node: TSESTree.Node | null): { module: string; imported: string } | null => {
      if (node === null) {
        return null;
      }
      let inner = unwrap(node);
      let imported = '*';
      if (inner.type === AST_NODE_TYPES.MemberExpression) {
        imported = propertyName(inner) ?? '';
        inner = unwrap(inner.object);
      }
      if (
        inner.type === AST_NODE_TYPES.CallExpression &&
        judge.isGlobal(unwrap(inner.callee), 'require') &&
        inner.arguments[0] !== undefined
      ) {
        const module = staticString(inner.arguments[0]);
        return module === null || imported === '' ? null : { module, imported };
      }
      return null;
    };

    /* ---- content types ------------------------------------------------- */

    interface TypeSetter {
      readonly value: string | null;
      /** True when it runs on every path to the sink. */
      readonly always: boolean;
    }

    /** The content type a header object literal sets: null when absent, `?` when unknown. */
    const headerObjectType = (node: TSESTree.Node | undefined): string | null => {
      const object = node === undefined ? null : unwrap(node);
      if (object?.type !== AST_NODE_TYPES.ObjectExpression) {
        return node === undefined ? null : '?';
      }
      for (const property of object.properties) {
        if (property.type !== AST_NODE_TYPES.Property) {
          return '?';
        }
        const key = propertyKey(property);
        if (key === null) {
          return '?';
        }
        if (key.toLowerCase() === 'content-type') {
          return staticString(property.value) ?? '?';
        }
      }
      return null;
    };

    /** The content type a call or assignment sets on `receiver`, `undefined` when it sets none. */
    const typeSetBy = (node: TSESTree.Node, receiver: string): string | null | undefined => {
      if (node.type === AST_NODE_TYPES.AssignmentExpression && node.operator === '=') {
        const left = unwrap(node.left);
        if (left.type !== AST_NODE_TYPES.MemberExpression || propertyName(left) !== 'type') {
          return undefined;
        }
        const target = receiverText(left.object, sourceCode);
        return target === receiver || target === `${receiver}.response` ? staticString(node.right) : undefined;
      }
      if (node.type !== AST_NODE_TYPES.CallExpression) {
        return undefined;
      }
      const callee = unwrap(node.callee);
      const method = callee.type === AST_NODE_TYPES.MemberExpression ? propertyName(callee) : null;
      if (callee.type !== AST_NODE_TYPES.MemberExpression || method === null) {
        return undefined;
      }
      const target = receiverText(callee.object, sourceCode);
      if (target !== receiver && target !== `${receiver}.response`) {
        return undefined;
      }
      const [first, second] = node.arguments;
      // Removing the header leaves the type to the framework, which may pick HTML.
      if ((method === 'removeHeader' || method === 'remove') && first !== undefined && staticString(first)?.toLowerCase() === 'content-type') {
        return null;
      }
      if (method === 'type' || method === 'contentType') {
        return first === undefined ? undefined : staticString(first);
      }
      if (HEADER_SETTERS.has(method) && first !== undefined) {
        const name = staticString(first);
        if (name !== null) {
          return name.toLowerCase() === 'content-type' ? (second === undefined ? null : staticString(second)) : undefined;
        }
        const type = headerObjectType(first);
        return type === '?' ? null : (type ?? undefined);
      }
      if (method === 'writeHead') {
        const type = headerObjectType(node.arguments.at(-1));
        return type === '?' ? null : (type ?? undefined);
      }
      return undefined;
    };

    /** True when `node` (a setter) runs whenever the code reaches `sink`, before it. */
    const runsBefore = (node: TSESTree.Node, sink: TSESTree.Node): boolean => {
      let statement: TSESTree.Node = node;
      while (
        statement.parent !== undefined &&
        ((statement.parent.type === AST_NODE_TYPES.MemberExpression && statement.parent.object === statement) ||
          (statement.parent.type === AST_NODE_TYPES.CallExpression && statement.parent.callee === statement) ||
          statement.parent.type === AST_NODE_TYPES.AwaitExpression)
      ) {
        statement = statement.parent;
      }
      if (statement.parent?.type !== AST_NODE_TYPES.ExpressionStatement) {
        return false;
      }
      statement = statement.parent;
      const block = statement.parent;
      return (
        (block?.type === AST_NODE_TYPES.BlockStatement || block?.type === AST_NODE_TYPES.Program) &&
        block.range[0] <= sink.range[0] &&
        sink.range[1] <= block.range[1] &&
        statement.range[1] <= sink.range[0]
      );
    };

    /** The content type setters on `receiver` before `sink` in its function, and in the sink's own chain. */
    const typeSetters = (sink: TSESTree.Node, receiver: string): TypeSetter[] => {
      const setters: TypeSetter[] = [];
      const scope = enclosingFunction(sink);
      const visit = (node: TSESTree.Node): void => {
        if (node.range[0] >= sink.range[0] || (node !== scope && isFunction(node))) {
          return;
        }
        const value = typeSetBy(node, receiver);
        if (value !== undefined) {
          setters.push({ value, always: runsBefore(node, sink) });
        }
        for (const key of sourceCode.visitorKeys[node.type] ?? []) {
          const child = (node as unknown as Record<string, unknown>)[key];
          for (const item of Array.isArray(child) ? child : [child]) {
            if (item !== null && typeof item === 'object' && 'type' in item) {
              visit(item as TSESTree.Node);
            }
          }
        }
      };
      if (scope !== null) {
        visit(scope.type === AST_NODE_TYPES.Program ? scope : scope.body);
      }
      // `res.type('text/plain').send(...)`: set on the way to the writer, always.
      if (sink.type === AST_NODE_TYPES.CallExpression) {
        let current: TSESTree.Node = unwrap(sink.callee);
        while (current.type === AST_NODE_TYPES.MemberExpression) {
          const object = unwrap(current.object);
          if (object.type !== AST_NODE_TYPES.CallExpression) {
            break;
          }
          const value = typeSetBy(object, receiver);
          if (value !== undefined) {
            setters.push({ value, always: true });
          }
          current = unwrap(object.callee);
        }
      }
      return setters;
    };

    const isScriptable = (type: string | null): boolean => type === null || SCRIPTABLE_TYPE.test(type);

    /* ---- judging -------------------------------------------------------- */

    const judgeParts = (parts: readonly Part[], sink: TSESTree.Node): void => {
      const unsafe = new Set<Part>();
      for (const part of parts) {
        if (part.inner?.some((innerPart) => unsafe.has(innerPart)) === true) {
          unsafe.add(part);
          continue;
        }
        for (const where of part.contexts) {
          if (judge.safeIn(part.node, where, sink)) {
            continue;
          }
          unsafe.add(part);
          const value = sourceCode.getText(part.node);
          if (where !== 'text' && judge.safeIn(part.node, 'text', sink)) {
            report(part.node, 'unsafeContext', { value, where: CONTEXT_LABELS[where] });
          } else {
            report(part.node, 'unescapedHtmlResponse', { value });
          }
          break;
        }
      }
    };

    /** True when a Koa body may start with `<` on some branch (``ok ? 'Done' : `<p>${q}</p>` ``). */
    const koaMayBeHtml = (body: TSESTree.Node, sink: TSESTree.Node, depth: number): boolean => {
      const inner = unwrap(body);
      if (depth <= MAX_DEPTH && inner.type === AST_NODE_TYPES.ConditionalExpression) {
        return koaMayBeHtml(inner.consequent, sink, depth + 1) || koaMayBeHtml(inner.alternate, sink, depth + 1);
      }
      if (depth <= MAX_DEPTH && inner.type === AST_NODE_TYPES.LogicalExpression) {
        return (inner.operator !== '&&' && koaMayBeHtml(inner.left, sink, depth + 1)) || koaMayBeHtml(inner.right, sink, depth + 1);
      }
      const builder = new HtmlBuilder(judge, sink);
      builder.run(inner);
      const leading = builder.leading.trimStart();
      return leading === '' || leading.startsWith('<');
    };

    const checkSink = (sink: WriteSink): void => {
      const setters = sink.kind === 'plain' ? [] : typeSetters(sink.node, sink.receiver);
      const htmlTyped = setters.some((setter) => setter.value !== null && SCRIPTABLE_TYPE.test(setter.value));
      const plainEverywhere =
        setters.some((setter) => setter.always && !isScriptable(setter.value)) &&
        !setters.some((setter) => isScriptable(setter.value));
      if (plainEverywhere || (sink.kind === 'reply' && !htmlTyped)) {
        return;
      }
      const builder = new HtmlBuilder(judge, sink.node);
      builder.run(sink.body);
      // Without an author tag, only values in markup a call is given are judged.
      const parts = TAG.test(builder.text) || builder.rendered ? builder.parts : builder.parts.filter((part) => part.forced);
      if (parts.length === 0) {
        return;
      }
      // Koa sends a string that does not start with `<` as text, unless a type is set.
      if (sink.kind === 'koa' && !setters.some((setter) => setter.value !== null) && !koaMayBeHtml(sink.body, sink.node, 0)) {
        return;
      }
      judgeParts(parts, sink.node);
    };

    /** The value a template path reads from a literal context object, through nested literals. */
    const lookup = (object: TSESTree.ObjectExpression, path: readonly string[]): TSESTree.Node | null => {
      const [head, ...rest] = path;
      let value: TSESTree.Node | null = null;
      for (const property of object.properties) {
        if (property.type === AST_NODE_TYPES.Property && propertyKey(property) === head) {
          value = property.value;
        }
      }
      if (value === null || rest.length === 0) {
        return value;
      }
      let inner = unwrap(value);
      if (inner.type === AST_NODE_TYPES.Identifier) {
        const init = judge.constInit(inner);
        inner = init === null ? inner : unwrap(init);
      }
      return inner.type === AST_NODE_TYPES.ObjectExpression ? lookup(inner, rest) : value;
    };

    const isEjs = (node: TSESTree.Node): boolean => {
      const inner = unwrap(node);
      return (
        inner.type === AST_NODE_TYPES.Identifier &&
        (inner.name === 'ejs' || judge.bindings.get(judge.variableOf(inner) as TSESLint.Scope.Variable)?.module === 'ejs')
      );
    };

    /** The module binding a variable holds, directly or through `const` aliases. */
    const aliasedBinding = (variable: TSESLint.Scope.Variable, depth = 0): ModuleBinding | null => {
      const binding = judge.bindings.get(variable);
      const def = variable.defs[0];
      if (binding !== undefined || depth > MAX_DEPTH) {
        return binding ?? null;
      }
      if (variable.defs.length !== 1 || def?.type !== 'Variable' || def.parent.kind !== 'const' || def.node.init === null) {
        return null;
      }
      const init = unwrap(def.node.init);
      const next = init.type === AST_NODE_TYPES.Identifier ? judge.variableOf(init) : null;
      return next === null ? null : aliasedBinding(next, depth + 1);
    };

    /**
     * True when a DOMPurify module binding is handed on (passed to a call,
     * assigned, exported) or has a member written, so its shared config may
     * change where the rule cannot see.
     */
    const purifierHandedOn = (variable: TSESLint.Scope.Variable, seen: Set<TSESLint.Scope.Variable> = new Set()): boolean => {
      if (seen.has(variable)) {
        return false;
      }
      seen.add(variable);
      return variable.references.some((reference) => {
        const id = reference.identifier;
        const parent = id.parent;
        if (reference.init === true || (parent?.type === AST_NODE_TYPES.CallExpression && parent.callee === id)) {
          return false;
        }
        if (parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === id) {
          return isWriteTarget(parent);
        }
        if (
          parent?.type === AST_NODE_TYPES.VariableDeclarator &&
          parent.init === id &&
          parent.id.type === AST_NODE_TYPES.Identifier &&
          parent.parent.kind === 'const'
        ) {
          const alias = judge.variableOf(parent.id);
          return alias === null || purifierHandedOn(alias, seen);
        }
        return true;
      });
    };

    /** How `ejs.render` reads its literal template, or null when its options cannot be read in full. */
    const ejsSettings = (call: TSESTree.CallExpression, data: TSESTree.ObjectExpression): EjsSettings | null => {
      if (ejsChanged) {
        return null;
      }
      const options = call.arguments[2];
      let object = data;
      if (options !== undefined) {
        let inner = options.type === AST_NODE_TYPES.SpreadElement ? null : unwrap(options);
        if (inner?.type === AST_NODE_TYPES.Identifier) {
          inner = unwrap(judge.constInit(inner) ?? inner);
        }
        if (inner?.type !== AST_NODE_TYPES.ObjectExpression) {
          return null;
        }
        object = inner;
      }
      let settings = EJS_DEFAULTS;
      for (const property of object.properties) {
        const key = property.type === AST_NODE_TYPES.Property ? propertyKey(property) : null;
        if (key === null || property.type !== AST_NODE_TYPES.Property) {
          // A spread or computed key may hold any option, `escape` or a delimiter included.
          return null;
        }
        // Without an options argument, EJS reads only a few options from the data.
        if (options === undefined && !EJS_DATA_OPTIONS.has(key)) {
          continue;
        }
        if (key === 'escape' || key === 'escapeFunction') {
          settings = { ...settings, escapes: false };
          continue;
        }
        const setting = EJS_TEXT_OPTIONS.get(key);
        if (setting !== undefined) {
          const text = staticString(property.value);
          if (text === null || text === '') {
            return null;
          }
          settings = { ...settings, [setting]: text };
          continue;
        }
        if (!EJS_NEUTRAL_OPTIONS.has(key)) {
          return null;
        }
      }
      return settings;
    };

    const templateEngine = (call: TSESTree.CallExpression): 'nunjucks' | 'ejs' | null => {
      const callee = unwrap(call.callee);
      if (callee.type === AST_NODE_TYPES.Identifier) {
        const variable = judge.variableOf(callee);
        const binding = variable === null ? undefined : judge.bindings.get(variable);
        if (callee.name === 'renderString') {
          return 'nunjucks';
        }
        return binding?.module === 'ejs' && binding.imported === 'render' ? 'ejs' : null;
      }
      if (callee.type !== AST_NODE_TYPES.MemberExpression) {
        return null;
      }
      const method = propertyName(callee);
      if (method === 'renderString') {
        return 'nunjucks';
      }
      return method === 'render' && isEjs(callee.object) ? 'ejs' : null;
    };

    const checkTemplateRender = (call: TSESTree.CallExpression): void => {
      const engine = templateEngine(call);
      const [template, data] = call.arguments;
      if (engine === null || template === undefined || data === undefined) {
        return;
      }
      if (template.type === AST_NODE_TYPES.SpreadElement || data.type === AST_NODE_TYPES.SpreadElement) {
        return;
      }
      let templateNode = unwrap(template);
      if (templateNode.type === AST_NODE_TYPES.Identifier) {
        templateNode = unwrap(judge.constInit(templateNode) ?? templateNode);
      }
      const text = staticString(templateNode);
      let object = unwrap(data);
      if (object.type === AST_NODE_TYPES.Identifier) {
        object = unwrap(judge.constInit(object) ?? object);
      }
      if (text === null || object.type !== AST_NODE_TYPES.ObjectExpression) {
        return;
      }
      let outputs: TemplateOutput[];
      if (engine === 'nunjucks') {
        outputs = nunjucksOutputs(text, !nunjucksRawEverywhere);
      } else {
        const settings = ejsSettings(call, object);
        outputs = settings === null ? everyValueRaw(object) : ejsOutputs(text, settings);
      }
      for (const output of outputs) {
        const value = lookup(object, output.path);
        if (value === null || value.type === AST_NODE_TYPES.AssignmentPattern || !('type' in value)) {
          continue;
        }
        for (const where of output.contexts) {
          if ((!output.raw && encodingSafeIn('escape-all', where)) || judge.safeIn(value, where, call)) {
            continue;
          }
          const valueText = sourceCode.getText(value);
          if (output.raw && !judge.safeIn(value, 'text', call)) {
            report(value, 'rawTemplateValue', { key: output.path.join('.'), value: valueText });
          } else {
            report(value, 'unsafeContext', { value: valueText, where: CONTEXT_LABELS[where] });
          }
          break;
        }
      }
    };

    /* ---- sink discovery ------------------------------------------------- */

    /** The content type `new Response(body, init)` sets in its literal headers. */
    const responseInitType = (init: TSESTree.Node | undefined): string | null => {
      if (init === undefined) {
        return null;
      }
      let object = unwrap(init);
      if (object.type === AST_NODE_TYPES.Identifier) {
        object = unwrap(judge.constInit(object) ?? object);
      }
      if (object.type !== AST_NODE_TYPES.ObjectExpression) {
        return null;
      }
      for (const property of object.properties) {
        if (property.type !== AST_NODE_TYPES.Property || propertyKey(property) !== 'headers') {
          continue;
        }
        let headers = unwrap(property.value);
        const holder = headers.type === AST_NODE_TYPES.Identifier ? headers : null;
        if (holder !== null) {
          headers = unwrap(judge.constInit(holder) ?? holder);
        }
        if (headers.type === AST_NODE_TYPES.NewExpression && judge.isGlobal(unwrap(headers.callee), 'Headers')) {
          const set = holder === null ? undefined : headersSetType(holder);
          if (set !== undefined) {
            return set;
          }
          const [first] = headers.arguments;
          headers = first === undefined ? headers : unwrap(first);
        }
        if (headers.type === AST_NODE_TYPES.ArrayExpression) {
          for (const pair of headers.elements) {
            const entry = pair === null ? null : unwrap(pair);
            if (entry?.type === AST_NODE_TYPES.ArrayExpression && entry.elements.length === 2) {
              const [name, value] = entry.elements;
              if (name && value && staticString(name)?.toLowerCase() === 'content-type') {
                return staticString(value);
              }
            }
          }
          return null;
        }
        const type = headerObjectType(headers);
        return type === '?' ? null : type;
      }
      return null;
    };

    /** The content type a `Headers` const gets from `.set` / `.append`, null when unknown, undefined when none. */
    const headersSetType = (holder: TSESTree.Identifier): string | null | undefined => {
      const variable = judge.variableOf(holder);
      for (const reference of variable?.references ?? []) {
        const parent = reference.identifier.parent;
        const method = parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === reference.identifier ? propertyName(parent) : null;
        const call = parent?.parent;
        if ((method === 'set' || method === 'append') && call?.type === AST_NODE_TYPES.CallExpression && call.callee === parent) {
          const [name, value] = call.arguments;
          if (name !== undefined && staticString(name)?.toLowerCase() === 'content-type') {
            return value === undefined ? null : staticString(value);
          }
        }
      }
      return undefined;
    };

    const isResponseConstructor = (callee: TSESTree.Node): boolean => {
      const inner = unwrap(callee);
      if (judge.isGlobal(inner, 'Response')) {
        return true;
      }
      if (inner.type !== AST_NODE_TYPES.Identifier) {
        return false;
      }
      const variable = judge.variableOf(inner);
      const binding = variable === null ? undefined : judge.bindings.get(variable);
      return binding?.module === 'next/server' && binding.imported === 'NextResponse';
    };

    /** The `@nestjs/common` export a decorator calls, or null. */
    const nestDecorator = (decorator: TSESTree.Decorator): { name: string; call: TSESTree.CallExpression } | null => {
      const expression = unwrap(decorator.expression);
      if (expression.type !== AST_NODE_TYPES.CallExpression) {
        return null;
      }
      const callee = unwrap(expression.callee);
      if (callee.type === AST_NODE_TYPES.MemberExpression) {
        // `@common.Get()` on a namespace import or a `require` of the module.
        const object = unwrap(callee.object);
        const variable = object.type === AST_NODE_TYPES.Identifier ? judge.variableOf(object) : null;
        const binding = variable === null ? undefined : judge.bindings.get(variable);
        const name = propertyName(callee);
        return binding?.module === '@nestjs/common' && (binding.imported === '*' || binding.imported === 'default') && name !== null
          ? { name, call: expression }
          : null;
      }
      const variable = callee.type === AST_NODE_TYPES.Identifier ? judge.variableOf(callee) : null;
      const binding = variable === null ? undefined : judge.bindings.get(variable);
      return binding?.module === '@nestjs/common' ? { name: binding.imported, call: expression } : null;
    };

    /**
     * True when a Nest handler's return value is sent as HTML: it carries
     * `@Header('Content-Type', '<html type>')`, or it is a route handler
     * (`@Get`, `@Post`, ...) with no content type header, which the Express
     * platform sends a string as `text/html`. A handler that renders a view,
     * redirects, streams events or takes the response (`@Res()`) does not
     * send its return value as the body.
     */
    const isHtmlNestHandler = (fn: FunctionLike): boolean => {
      const method = fn.parent;
      if (method?.type !== AST_NODE_TYPES.MethodDefinition || method.value !== fn) {
        return false;
      }
      let route = false;
      let type: string | null | undefined;
      for (const decorator of method.decorators) {
        const nest = nestDecorator(decorator);
        if (nest === null) {
          continue;
        }
        if (NEST_ROUTES.has(nest.name)) {
          route = true;
        } else if (nest.name === 'Render' || nest.name === 'Redirect' || nest.name === 'Sse') {
          return false;
        } else if (nest.name === 'Header') {
          const [name, value] = nest.call.arguments;
          if (name !== undefined && staticString(name)?.toLowerCase() === 'content-type') {
            type = value === undefined ? null : staticString(value);
          }
        }
      }
      if (type !== undefined) {
        return isScriptable(type);
      }
      const takesResponse = fn.params.some((param) =>
        (param.type === AST_NODE_TYPES.Identifier ||
        param.type === AST_NODE_TYPES.AssignmentPattern ||
        param.type === AST_NODE_TYPES.TSParameterProperty
          ? param.decorators
          : []
        ).some((decorator) => {
          const name = nestDecorator(decorator)?.name;
          return name === 'Res' || name === 'Response' || name === 'Next';
        }),
      );
      return route && !takesResponse;
    };

    const returns: TSESTree.ReturnStatement[] = [];
    const responses: TSESTree.NewExpression[] = [];
    const environmentCalls: (TSESTree.CallExpression | TSESTree.NewExpression)[] = [];

    return {
      ImportDeclaration(node): void {
        const module = String(node.source.value);
        for (const specifier of node.specifiers) {
          if (specifier.type === AST_NODE_TYPES.ImportNamespaceSpecifier) {
            bindModule(specifier.local, module, '*');
          } else if (specifier.type === AST_NODE_TYPES.ImportDefaultSpecifier) {
            bindModule(specifier.local, module, 'default');
          } else {
            const imported =
              specifier.imported.type === AST_NODE_TYPES.Identifier ? specifier.imported.name : String(specifier.imported.value);
            bindModule(specifier.local, module, imported);
          }
        }
      },
      VariableDeclarator(node): void {
        const required = requiredModule(node.init);
        if (required !== null) {
          if (node.id.type === AST_NODE_TYPES.Identifier) {
            bindModule(node.id, required.module, required.imported);
          } else if (node.id.type === AST_NODE_TYPES.ObjectPattern && required.imported === '*') {
            for (const property of node.id.properties) {
              if (property.type === AST_NODE_TYPES.Property) {
                const key = propertyKey(property);
                const value = unwrap(property.value);
                if (key !== null && value.type === AST_NODE_TYPES.Identifier) {
                  bindModule(value, required.module, key);
                }
              }
            }
          }
          return;
        }
        if (node.id.type === AST_NODE_TYPES.Identifier && node.init !== null && unwrap(node.init).type === AST_NODE_TYPES.CallExpression) {
          factoryDeclarators.push(node);
        }
      },
      CallExpression(node): void {
        const callee = unwrap(node.callee);
        if (callee.type === AST_NODE_TYPES.MemberExpression) {
          const method = propertyName(callee);
          if (method !== null && BODY_WRITERS.has(method)) {
            const receiver = receiverText(callee.object, sourceCode);
            const body = node.arguments[0];
            if (body !== undefined && body.type !== AST_NODE_TYPES.SpreadElement) {
              if (responseObjects.has(receiver)) {
                sinks.push({ kind: 'write', node, body, receiver });
              } else if (replyObjects.has(receiver) && method === 'send') {
                sinks.push({ kind: 'reply', node, body, receiver });
              }
            }
          }
          if (method === 'setConfig') {
            purifierConfigs.push(node);
          }
          if (method === 'configure') {
            environmentCalls.push(node);
          }
        }
        templateCalls.push(node);
        ejsWrites.push(...node.arguments);
      },
      NewExpression(node): void {
        responses.push(node);
        const callee = unwrap(node.callee);
        if (
          (callee.type === AST_NODE_TYPES.Identifier && callee.name === 'Environment') ||
          (callee.type === AST_NODE_TYPES.MemberExpression && propertyName(callee) === 'Environment')
        ) {
          environmentCalls.push(node);
        }
      },
      AssignmentExpression(node): void {
        const left = unwrap(node.left);
        if (left.type === AST_NODE_TYPES.MemberExpression) {
          let root: TSESTree.Node = left;
          while (root.type === AST_NODE_TYPES.MemberExpression) {
            root = unwrap(root.object);
          }
          ejsWrites.push(root);
        }
        if (node.operator !== '=' || left.type !== AST_NODE_TYPES.MemberExpression || propertyName(left) !== 'body') {
          return;
        }
        let receiver = receiverText(left.object, sourceCode);
        if (receiver.endsWith('.response')) {
          receiver = receiver.slice(0, -'.response'.length);
        }
        if (contextObjects.has(receiver)) {
          sinks.push({ kind: 'koa', node, body: node.right, receiver });
        }
      },
      ReturnStatement(node): void {
        if (node.argument !== null) {
          returns.push(node);
        }
      },
      'Program:exit'(): void {
        // Bindings first: instances, weakened configs, global engine settings.
        for (const declarator of factoryDeclarators) {
          const init = unwrap(declarator.init as TSESTree.Node) as TSESTree.CallExpression;
          if (judge.isPurifierFactory(init.callee)) {
            const variable = judge.variableOf(declarator.id as TSESTree.Identifier);
            if (variable !== null) {
              judge.purifiers.add(variable);
            }
          }
        }
        for (const call of purifierConfigs) {
          const object = unwrap((unwrap(call.callee) as TSESTree.MemberExpression).object);
          const variable = object.type === AST_NODE_TYPES.Identifier ? judge.variableOf(object) : null;
          const binding = variable === null ? null : aliasedBinding(variable);
          if (
            variable !== null &&
            (judge.purifiers.has(variable) || binding?.module.includes('dompurify') === true) &&
            !judge.domPurifyConfigSafe(call.arguments[0])
          ) {
            judge.weakenedPurifiers.add(variable);
            // The default export is the module's one instance: every import of it shares the config.
            if (binding !== null && (binding.imported === '*' || binding.imported === 'default')) {
              judge.weakenedModules.add(binding.module);
            }
          }
        }
        for (const call of templateCalls) {
          const callee = unwrap(call.callee);
          const variable = callee.type === AST_NODE_TYPES.Identifier ? judge.variableOf(callee) : null;
          const binding = variable === null ? null : aliasedBinding(variable);
          if (
            binding?.imported === 'setConfig' &&
            PURIFY_MODULES.has(binding.module) &&
            !judge.domPurifyConfigSafe(call.arguments[0])
          ) {
            judge.weakenedModules.add(binding.module);
          }
        }
        for (const [variable, binding] of judge.bindings) {
          if (
            PURIFY_MODULES.has(binding.module) &&
            (binding.imported === '*' || binding.imported === 'default') &&
            purifierHandedOn(variable)
          ) {
            judge.weakenedModules.add(binding.module);
          }
        }
        judge.findChangedDefaults();
        ejsChanged = ejsWrites.some((node) => isEjs(node));
        nunjucksRawEverywhere = environmentCalls.some((call) =>
          call.arguments.some((arg) => {
            const object = unwrap(arg);
            return (
              object.type === AST_NODE_TYPES.ObjectExpression &&
              object.properties.some(
                (property) =>
                  property.type === AST_NODE_TYPES.Property &&
                  propertyKey(property) === 'autoescape' &&
                  !(unwrap(property.value).type === AST_NODE_TYPES.Literal && (unwrap(property.value) as TSESTree.Literal).value === true),
              )
            );
          }),
        );
        for (const node of responses) {
          const [body, init] = node.arguments;
          const type = responseInitType(init);
          if (
            body !== undefined &&
            body.type !== AST_NODE_TYPES.SpreadElement &&
            isResponseConstructor(node.callee) &&
            type !== null &&
            SCRIPTABLE_TYPE.test(type)
          ) {
            sinks.push({ kind: 'plain', node, body, receiver: '' });
          }
        }
        for (const node of returns) {
          const fn = enclosingFunction(node);
          if (fn === null || fn.type === AST_NODE_TYPES.Program || node.argument === null) {
            continue;
          }
          if (isHtmlNestHandler(fn)) {
            sinks.push({ kind: 'plain', node, body: node.argument, receiver: '' });
            continue;
          }
          // A Fastify async handler sends what it returns, as HTML once the type is set on its reply.
          const reply = fn.params.find(
            (param): param is TSESTree.Identifier => param.type === AST_NODE_TYPES.Identifier && replyObjects.has(param.name),
          );
          if (reply !== undefined && fn.async) {
            sinks.push({ kind: 'reply', node, body: node.argument, receiver: reply.name });
          }
        }
        for (const sink of sinks) {
          checkSink(sink);
        }
        for (const call of templateCalls) {
          checkTemplateRender(call);
        }
      },
    };
  },
});
