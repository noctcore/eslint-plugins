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
   * (`utils.escapeHtml`) matches that callee text; an entry without one
   * (`escapeHtml`) matches a call by that bare name, never a method. Modules
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
 * with an HTML content type (Fastify), `ctx.body = ...` (Koa), `new
 * Response(body, { headers: { 'content-type': 'text/html' } })` (fetch, Next
 * route handlers), the return value of a Nest handler with
 * `@Header('Content-Type', 'text/html')`, and nunjucks `renderString` /
 * `ejs.render` with a literal template.
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
const TAG = /<[a-z!/]/iu;
/** Content types a browser renders as markup that can run script. */
const SCRIPTABLE_TYPE = /htm|xml|svg/iu;
const MAX_DEPTH = 8;
const MAX_STATES = 24;

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
      'Escapers trusted to encode `&`, `<`, `>` and `"`. An entry with a dot matches that callee; one without matches a call by that bare name, never a method. Replaces the defaults.',
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
      return (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        propertyName(callee) === 'join' &&
        buildsMarkup(callee.object, depth + 1)
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

interface Part {
  readonly node: TSESTree.Node;
  readonly contexts: ReadonlySet<HtmlContext>;
}

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
  private sawDynamic = false;
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

  private dynamic(node: TSESTree.Node, states: readonly HtmlState[]): HtmlState[] {
    this.sawDynamic = true;
    this.parts.push({ node, contexts: new Set(states.map(contextAt)) });
    return dedupe(states.map(feedValue));
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
    if (init !== null && buildsMarkup(init) && variable !== null) {
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
    const fn = this.judge.functionOf(callee);
    const returned = fn === null ? null : returnedExpression(fn);
    if (fn === null || returned === null || !buildsMarkup(returned) || this.active.has(fn)) {
      return this.dynamic(call, states);
    }
    // A helper that returns markup: its parameters are the call's arguments.
    const bound: TSESLint.Scope.Variable[] = [];
    fn.params.forEach((param, index) => {
      const argument = call.arguments[index];
      if (param.type === AST_NODE_TYPES.Identifier && argument !== undefined && argument.type !== AST_NODE_TYPES.SpreadElement) {
        const variable = this.judge.variableOf(param);
        if (variable !== null) {
          this.bound.set(variable, argument);
          bound.push(variable);
        }
      }
    });
    this.active.add(fn);
    const result = this.visit(returned, states, depth + 1);
    this.active.delete(fn);
    for (const variable of bound) {
      this.bound.delete(variable);
    }
    return result;
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
    const list = unwrap(callee.object);
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
    const body = fn === null ? null : returnedExpression(fn);
    if (mapCallee.type !== AST_NODE_TYPES.MemberExpression || propertyName(mapCallee) !== 'map' || body === null) {
      return null;
    }
    let all = dedupe(states);
    let current = all;
    for (let round = 0; round < 3; round += 1) {
      const next = this.feed(this.visit(body, current, depth + 1), separator);
      const merged = dedupe([...all, ...next]);
      if (merged.length === all.length) {
        break;
      }
      all = merged;
      current = next;
    }
    return all;
  }
}

/** One output of a literal template: the value path it prints, whether raw, and where it lands. */
interface TemplateOutput {
  readonly path: readonly string[];
  readonly raw: boolean;
  readonly contexts: ReadonlySet<HtmlContext>;
}

const PATH = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*/u;

/** The outputs of a nunjucks template, with `{% autoescape %}` blocks and the `safe` / `escape` filters read. */
function nunjucksOutputs(template: string, autoescape: boolean): TemplateOutput[] {
  const outputs: TemplateOutput[] = [];
  const escaping: boolean[] = [autoescape];
  let state = START_STATE;
  let last = 0;
  for (const match of template.matchAll(/\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}|\{#[\s\S]*?#\}/gu)) {
    state = feedText(state, template.slice(last, match.index));
    last = match.index + match[0].length;
    const tag = match[2];
    if (tag !== undefined) {
      const block = /^\s*(autoescape|endautoescape)\b\s*(\S*)/u.exec(tag);
      if (block?.[1] === 'autoescape') {
        // Anything but a literal `true` may switch escaping off.
        escaping.push(block[2] === 'true');
      } else if (block?.[1] === 'endautoescape' && escaping.length > 1) {
        escaping.pop();
      }
      continue;
    }
    const expression = match[1];
    if (expression === undefined) {
      continue;
    }
    // A value path, then anything (`["key"]`, `[0]`, `~ other`) up to the filters.
    const output = PATH.exec(expression);
    const [head = '', ...filters] = (output === null ? '' : expression.slice(output[0].length)).split('|');
    if (output?.[1] !== undefined && !head.trimStart().startsWith('(')) {
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
      outputs.push({
        path: output[1].split('.'),
        raw: !escaped && (marked || escaping.at(-1) !== true),
        contexts: new Set([contextAt(state)]),
      });
    }
    state = feedValue(state);
  }
  return outputs;
}

/** The outputs of an EJS template: `<%=` escaped, `<%-` raw. */
function ejsOutputs(template: string): TemplateOutput[] {
  const outputs: TemplateOutput[] = [];
  let state = START_STATE;
  let last = 0;
  for (const match of template.matchAll(/<%%|<%([=\-_#]?)([\s\S]*?)[-_]?%>/gu)) {
    state = feedText(state, template.slice(last, match.index));
    last = match.index + match[0].length;
    const kind = match[1];
    if (match[0] === '<%%') {
      // A literal `<%`.
      state = feedText(state, '<%');
      continue;
    }
    if (kind !== '=' && kind !== '-') {
      continue;
    }
    const path = PATH.exec(match[2] ?? '');
    const rest = path === null ? '' : (match[2] ?? '').slice(path[0].length);
    if (path?.[1] !== undefined && !rest.startsWith('(')) {
      const segments = path[1].split('.');
      outputs.push({
        path: segments[0] === 'locals' && segments.length > 1 ? segments.slice(1) : segments,
        raw: kind === '-',
        contexts: new Set([contextAt(state)]),
      });
    }
    state = feedValue(state);
  }
  return outputs;
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
      for (const part of parts) {
        for (const where of part.contexts) {
          if (judge.safeIn(part.node, where, sink)) {
            continue;
          }
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
      if (!TAG.test(builder.text)) {
        return;
      }
      // Koa sends a string that does not start with `<` as text, unless a type is set.
      const leading = builder.leading.trimStart();
      if (sink.kind === 'koa' && !setters.some((setter) => setter.value !== null) && leading !== '' && !leading.startsWith('<')) {
        return;
      }
      judgeParts(builder.parts, sink.node);
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
      const outputs = engine === 'nunjucks' ? nunjucksOutputs(text, !nunjucksRawEverywhere) : ejsOutputs(text);
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
        if (headers.type === AST_NODE_TYPES.NewExpression && judge.isGlobal(unwrap(headers.callee), 'Headers')) {
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

    /** True when a Nest handler carries `@Header('Content-Type', '<html type>')` from `@nestjs/common`. */
    const isHtmlNestHandler = (fn: FunctionLike): boolean => {
      const method = fn.parent;
      if (method?.type !== AST_NODE_TYPES.MethodDefinition || method.value !== fn) {
        return false;
      }
      return method.decorators.some((decorator) => {
        const expression = unwrap(decorator.expression);
        if (expression.type !== AST_NODE_TYPES.CallExpression) {
          return false;
        }
        const callee = unwrap(expression.callee);
        const variable = callee.type === AST_NODE_TYPES.Identifier ? judge.variableOf(callee) : null;
        const binding = variable === null ? undefined : judge.bindings.get(variable);
        const [name, value] = expression.arguments;
        return (
          binding?.module === '@nestjs/common' &&
          binding.imported === 'Header' &&
          name !== undefined &&
          value !== undefined &&
          staticString(name)?.toLowerCase() === 'content-type' &&
          SCRIPTABLE_TYPE.test(staticString(value) ?? '')
        );
      });
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
          if (variable !== null && (judge.purifiers.has(variable) || judge.bindings.get(variable)?.module.includes('dompurify') === true)) {
            if (!judge.domPurifyConfigSafe(call.arguments[0])) {
              judge.weakenedPurifiers.add(variable);
            }
          }
        }
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
          if (fn !== null && fn.type !== AST_NODE_TYPES.Program && isHtmlNestHandler(fn) && node.argument !== null) {
            sinks.push({ kind: 'plain', node, body: node.argument, receiver: '' });
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
