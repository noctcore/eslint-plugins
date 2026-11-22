import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

/*
 * Proof that a runtime value is harmless at a sink, read from the code around
 * the sink. Shared by the injection rules (shell, path, HTML) and the URL rules
 * (redirect, fetch).
 *
 * A value is proven when the function checked it and gave up otherwise, before
 * the sink runs:
 *
 *   if (!ALLOWED.includes(sort)) return res.status(400).end();
 *   exec(`ls --sort ${sort}`);
 *
 * The check must be one the rule can read: an allowlist of literals
 * (`includes` / `has` / `===`), or a regex that is anchored at both ends and
 * whose every character is harmless in the sink's context. "Gave up" means an
 * `if` whose branch ends in `return`, `throw`, `break` or `continue`, before the
 * sink in an enclosing block of the same function, or an `if (check) { ...sink... }`
 * around it. The search stops at the first enclosing function, so a check
 * outside a callback or a hoisted function does not count inside it. Every
 * write to the checked binding must come before the check, and no nested
 * function may write it at all, so it cannot change after the check. An
 * allowlist counts only when it never changes: a `const` array or `Set` of
 * literals, not exported, whose every use is an `includes` / `has` call (or,
 * for an array, `new Set(list)`). `const` aliases (`const safe = checked`) and
 * the global `String(x)` are seen through.
 *
 * A URL is host-pinned when `new URL(url).hostname` (or `.host` / `.origin`) was
 * read into a binding and that binding passed an allowlist the same way, with
 * a regex that ends in a literal domain (`^(app|docs)\.example\.com$`).
 */

/** Where a value lands, which decides the characters a regex may admit. */
export type GuardContext = 'shell' | 'html' | 'path';

/** Characters each context must never receive from a value it cannot see. */
const UNSAFE_CHARACTERS: Readonly<Record<GuardContext, string>> = {
  // Command separators, substitution, quoting, redirection, globbing and
  // escapes. Space, `-`, `%` and `#` split, flag or comment but cannot start a
  // second command.
  shell: ';&|$`()<>{}[]*?!~\'"\\^\n\r',
  html: '<>&"\'`',
  // Separators (and a drive letter's `:`) are what move a path elsewhere.
  path: '/\\:\0',
};

const MAX_DEPTH = 8;

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;

// ---------------------------------------------------------------------------
// Regex analysis
// ---------------------------------------------------------------------------

/** The characters a `\` escape stands for, or null when it is not a fixed set. */
function escapeCharacters(letter: string): string | null {
  switch (letter) {
    case 'd':
      return '0123456789';
    case 'w':
      return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
    case 's':
      return ' \t\n\r\v\f\u00a0\u2028\u2029\ufeff';
    case 't':
      return '\t';
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 'v':
      return '\v';
    case 'f':
      return '\f';
    default:
      // A punctuation escape (`\.`, `\-`, `\/`) is that character. Letters and
      // digits (`\S`, `\W`, `\b`, `\x41`, `\1`, `\p{L}`) are classes,
      // assertions or code points this reader does not expand.
      return /[a-z0-9]/iu.test(letter) ? null : letter;
  }
}

interface RegexToken {
  readonly kind: 'chars' | 'any' | 'open' | 'close' | 'alt' | 'quantifier' | 'anchor' | 'unknown';
  /** For `chars`: every character the token can consume. */
  readonly chars?: string;
  /** For `chars`: a single literal character, as written. */
  readonly literal?: boolean;
}

/** Splits a pattern into tokens; null for syntax this reader does not handle. */
function tokenize(pattern: string): RegexToken[] | null {
  const tokens: RegexToken[] = [];
  let i = 0;
  while (i < pattern.length) {
    const char = pattern.charAt(i);
    if (char === '\\') {
      const chars = escapeCharacters(pattern.charAt(i + 1));
      if (chars === null) {
        return null;
      }
      tokens.push({ kind: 'chars', chars, literal: chars.length === 1 });
      i += 2;
    } else if (char === '[') {
      const end = classEnd(pattern, i);
      if (end === -1) {
        return null;
      }
      const chars = classCharacters(pattern.slice(i + 1, end));
      if (chars === null) {
        return null;
      }
      tokens.push({ kind: 'chars', chars });
      i = end + 1;
    } else if (char === '(') {
      if (pattern.startsWith('(?:', i)) {
        i += 3;
      } else if (pattern.startsWith('(?<', i) && !/^\(\?<[=!]/u.test(pattern.slice(i))) {
        const close = pattern.indexOf('>', i);
        if (close === -1) {
          return null;
        }
        i = close + 1;
      } else if (pattern.startsWith('(?', i)) {
        // Lookarounds and modifiers: not read.
        return null;
      } else {
        i += 1;
      }
      tokens.push({ kind: 'open' });
    } else if (char === ')') {
      tokens.push({ kind: 'close' });
      i += 1;
    } else if (char === '|') {
      tokens.push({ kind: 'alt' });
      i += 1;
    } else if (char === '*' || char === '+' || char === '?') {
      tokens.push({ kind: 'quantifier' });
      i += 1;
    } else if (char === '{') {
      const match = /^\{\d+(,\d*)?\}/u.exec(pattern.slice(i));
      if (match === null) {
        tokens.push({ kind: 'chars', chars: '{', literal: true });
        i += 1;
      } else {
        tokens.push({ kind: 'quantifier' });
        i += match[0].length;
      }
    } else if (char === '.') {
      tokens.push({ kind: 'any' });
      i += 1;
    } else if (char === '^' || char === '$') {
      tokens.push({ kind: 'anchor', chars: char });
      i += 1;
    } else {
      tokens.push({ kind: 'chars', chars: char, literal: true });
      i += 1;
    }
  }
  return tokens;
}

/**
 * Index of the `]` closing the class that opens at `start`, or -1. In
 * JavaScript `[]` is an empty class and `[^]` matches anything; a leading `]`
 * does not belong to the class as it does in PCRE.
 */
function classEnd(pattern: string, start: number): number {
  let i = start + 1;
  while (i < pattern.length) {
    const char = pattern.charAt(i);
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === ']') {
      return i;
    }
    i += 1;
  }
  return -1;
}

/** Every character a class body admits, or null for a negated or unread class. */
function classCharacters(body: string): string | null {
  if (body.startsWith('^')) {
    return null;
  }
  const singles: string[] = [];
  let i = 0;
  while (i < body.length) {
    let first: string;
    if (body.charAt(i) === '\\') {
      const chars = escapeCharacters(body.charAt(i + 1));
      if (chars === null) {
        return null;
      }
      i += 2;
      if (chars.length !== 1) {
        singles.push(chars);
        continue;
      }
      first = chars;
    } else {
      first = body.charAt(i);
      i += 1;
    }
    if (body.charAt(i) === '-' && i + 1 < body.length) {
      let last: string;
      if (body.charAt(i + 1) === '\\') {
        const chars = escapeCharacters(body.charAt(i + 2));
        if (chars?.length !== 1) {
          return null;
        }
        last = chars;
        i += 3;
      } else {
        last = body.charAt(i + 1);
        i += 2;
      }
      singles.push(expandRange(first, last));
      continue;
    }
    singles.push(first);
  }
  return singles.join('');
}

/**
 * The characters of a range, kept to what matters: the range is expanded only
 * through the printable ASCII block plus the control characters, and any range
 * reaching past `~` is marked with every unsafe character.
 */
function expandRange(first: string, last: string): string {
  const from = first.codePointAt(0) ?? 0;
  const to = last.codePointAt(0) ?? 0;
  let out = '';
  for (let code = from; code <= Math.min(to, 0x7e); code += 1) {
    out += String.fromCodePoint(code);
  }
  if (to > 0x7e) {
    out += Object.values(UNSAFE_CHARACTERS).join('');
  }
  return out;
}

/** The pattern's tokens without its `^` and `$`, or null when it is not anchored at both ends. */
function anchoredBody(pattern: string, flags: string): RegexToken[] | null {
  if (flags.includes('m') || flags.includes('v')) {
    return null;
  }
  const tokens = tokenize(pattern);
  if (tokens === null || tokens.length < 2) {
    return null;
  }
  const first = tokens[0];
  const last = tokens.at(-1);
  if (first?.kind !== 'anchor' || first.chars !== '^' || last?.kind !== 'anchor' || last.chars !== '$') {
    return null;
  }
  const body = tokens.slice(1, -1);
  let depth = 0;
  for (const token of body) {
    if (token.kind === 'open') {
      depth += 1;
    } else if (token.kind === 'close') {
      depth -= 1;
    } else if (token.kind === 'anchor' || (token.kind === 'alt' && depth === 0)) {
      // `^a|b$` anchors each side once; a `^` or `$` inside is not read.
      return null;
    }
  }
  return depth === 0 ? body : null;
}

/**
 * True when every string the regex accepts is made only of characters that are
 * harmless in `context`: anchored `^...$`, no `m` flag, no `.`, and no class or
 * escape that admits an unsafe character.
 */
export function regexAdmitsOnlySafe(pattern: string, flags: string, context: GuardContext): boolean {
  const body = anchoredBody(pattern, flags);
  if (body === null) {
    return false;
  }
  const unsafe = UNSAFE_CHARACTERS[context];
  return body.every(
    (token) =>
      token.kind !== 'any' &&
      token.kind !== 'unknown' &&
      (token.kind !== 'chars' || ![...(token.chars ?? '')].some((char) => unsafe.includes(char))),
  );
}

/**
 * True when the regex can only accept host names under a literal domain:
 * anchored `^...$`, no `m` flag, no `.` wildcard, and every way it can end is
 * `\.` followed by literal letters (`^(app|docs)\.example\.com$`).
 */
export function regexPinsHost(pattern: string, flags: string): boolean {
  const body = anchoredBody(pattern, flags);
  if (body === null || body.some((token) => token.kind === 'any')) {
    return false;
  }
  return endsWithLiteralDomain(body);
}

function endsWithLiteralDomain(tokens: readonly RegexToken[]): boolean {
  const last = tokens.at(-1);
  if (last?.kind === 'close') {
    // Find the matching open, then require every alternative inside to end in a literal domain.
    let depth = 0;
    let open = -1;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      if (token?.kind === 'close') {
        depth += 1;
      } else if (token?.kind === 'open') {
        depth -= 1;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    if (open === -1) {
      return false;
    }
    return splitAlternatives(tokens.slice(open + 1, -1)).every(endsWithLiteralDomain);
  }
  // Walk back over literal label characters to a literal `.`.
  let i = tokens.length - 1;
  let labelLength = 0;
  while (i >= 0) {
    const token = tokens[i];
    if (token?.kind !== 'chars' || token.literal !== true) {
      return false;
    }
    if (token.chars === '.') {
      return labelLength > 0;
    }
    if (!/^[a-z0-9-]$/iu.test(token.chars ?? '')) {
      return false;
    }
    labelLength += 1;
    i -= 1;
  }
  return false;
}

function splitAlternatives(tokens: readonly RegexToken[]): RegexToken[][] {
  const alternatives: RegexToken[][] = [[]];
  let depth = 0;
  for (const token of tokens) {
    if (token.kind === 'open') {
      depth += 1;
    } else if (token.kind === 'close') {
      depth -= 1;
    }
    if (token.kind === 'alt' && depth === 0) {
      alternatives.push([]);
    } else {
      alternatives.at(-1)?.push(token);
    }
  }
  return alternatives;
}

// ---------------------------------------------------------------------------
// Bindings
// ---------------------------------------------------------------------------

/** Peels type wrappers and `await`, which do not change the value. */
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

/**
 * Peels wrappers that keep a string's characters: `String(x)` and a template
 * holding only `${x}`.
 */
function peelStringWrappers(node: TSESTree.Node, sourceCode?: SourceCode): TSESTree.Node {
  let current = unwrap(node);
  for (;;) {
    if (
      current.type === AST_NODE_TYPES.CallExpression &&
      current.callee.type === AST_NODE_TYPES.Identifier &&
      current.callee.name === 'String' &&
      (sourceCode === undefined || isGlobal(current.callee, 'String', sourceCode)) &&
      current.arguments.length === 1 &&
      current.arguments[0]?.type !== AST_NODE_TYPES.SpreadElement
    ) {
      current = unwrap(current.arguments[0] as TSESTree.Node);
    } else if (
      current.type === AST_NODE_TYPES.TemplateLiteral &&
      current.expressions.length === 1 &&
      current.quasis.every((quasi) => quasi.value.cooked === '')
    ) {
      current = unwrap(current.expressions[0] as TSESTree.Node);
    } else {
      return current;
    }
  }
}

function variableOf(node: TSESTree.Identifier, sourceCode: SourceCode): Variable | null {
  return ASTUtils.findVariable(sourceCode.getScope(node), node);
}

/** True when `node` names the global `name`, not a local binding that shadows it. */
function isGlobal(node: TSESTree.Node, name: string, sourceCode: SourceCode): boolean {
  if (node.type !== AST_NODE_TYPES.Identifier || node.name !== name) {
    return false;
  }
  const variable = variableOf(node, sourceCode);
  return variable === null || variable.defs.length === 0;
}

/** The variable a subject expression reads, through `String(x)` and `${x}`. */
function subjectVariable(node: TSESTree.Node, sourceCode: SourceCode): Variable | null {
  const inner = peelStringWrappers(node, sourceCode);
  return inner.type === AST_NODE_TYPES.Identifier ? variableOf(inner, sourceCode) : null;
}

/**
 * True when every write to `variable` ends at or before `position`, and no
 * function nested in the one that declares it writes it: such a write runs
 * whenever the function is called, which source order does not tell.
 */
function writtenOnlyBefore(variable: Variable, position: number): boolean {
  const home = variable.scope.variableScope;
  return variable.references.every(
    (reference) =>
      (!reference.isWrite() && !mutatesContents(reference.identifier)) ||
      (reference.from.variableScope === home && reference.identifier.range[1] <= position),
  );
}

/** Methods that change an array, `Set` or `Map` in place. */
const MUTATING_METHODS: ReadonlySet<string> = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'fill',
  'sort',
  'reverse',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

/**
 * True when a reference changes what the binding holds without assigning it:
 * `x.push(y)`, `x[0] = y`, `x.length = 0`, `x.n++`. A checked array that is
 * changed after the check no longer holds the checked text.
 */
function mutatesContents(identifier: TSESTree.Node): boolean {
  const member = identifier.parent;
  if (member?.type !== AST_NODE_TYPES.MemberExpression || member.object !== identifier) {
    return false;
  }
  const use = member.parent;
  if (
    (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === member) ||
    (use.type === AST_NODE_TYPES.UpdateExpression && use.argument === member)
  ) {
    return true;
  }
  return (
    use.type === AST_NODE_TYPES.CallExpression &&
    use.callee === member &&
    !member.computed &&
    member.property.type === AST_NODE_TYPES.Identifier &&
    MUTATING_METHODS.has(member.property.name)
  );
}

/** The initializer of a `const` declared once with a plain identifier, else null. */
function constInit(variable: Variable): TSESTree.Expression | null {
  const def = variable.defs[0];
  if (
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'const' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier ||
    def.node.init === null
  ) {
    return null;
  }
  return def.node.init;
}

/** Resolves an identifier to its in-file `const` initializer, repeatedly. */
function resolveConst(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.Node {
  let current = unwrap(node);
  for (let depth = 0; depth < MAX_DEPTH && current.type === AST_NODE_TYPES.Identifier; depth += 1) {
    const variable = variableOf(current, sourceCode);
    const init = variable === null ? null : constInit(variable);
    if (init === null) {
      return current;
    }
    current = unwrap(init);
  }
  return current;
}

function isStaticLiteral(node: TSESTree.Node): boolean {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.Literal) {
    return typeof inner.value === 'string' || typeof inner.value === 'number';
  }
  return inner.type === AST_NODE_TYPES.TemplateLiteral && inner.expressions.length === 0;
}

/** True when `node` is the receiver of a `.<method>(...)` call. */
function isMethodReceiver(node: TSESTree.Node, methods: ReadonlySet<string>): boolean {
  const member = node.parent;
  return (
    member?.type === AST_NODE_TYPES.MemberExpression &&
    member.object === node &&
    !member.computed &&
    member.property.type === AST_NODE_TYPES.Identifier &&
    methods.has(member.property.name) &&
    member.parent.type === AST_NODE_TYPES.CallExpression &&
    member.parent.callee === member
  );
}

const LIST_READS: ReadonlySet<string> = new Set(['includes']);
const SET_READS: ReadonlySet<string> = new Set(['has']);

/**
 * True when an identifier names a `const` whose contents never change: it is
 * not exported, and every use of it is a read the caller allows (a `.includes`
 * / `.has` receiver, or the argument of `new Set(list)`). `const` fixes the
 * binding, not the array or `Set` it holds.
 */
function isUnchangedConst(node: TSESTree.Node, reads: ReadonlySet<string>, sourceCode: SourceCode): boolean {
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    // An inline literal cannot be reached by anything else.
    return true;
  }
  const variable = variableOf(inner, sourceCode);
  const def = variable?.defs[0];
  if (variable === null || def?.type !== 'Variable' || def.parent.parent.type === AST_NODE_TYPES.ExportNamedDeclaration) {
    return false;
  }
  return variable.references.every((reference) => {
    if (reference.init === true) {
      return true;
    }
    const identifier = reference.identifier;
    if (!reference.isRead() || reference.isWrite()) {
      return false;
    }
    if (isMethodReceiver(identifier, reads)) {
      return true;
    }
    const parent = identifier.parent;
    return (
      reads === LIST_READS &&
      parent?.type === AST_NODE_TYPES.NewExpression &&
      isGlobal(parent.callee, 'Set', sourceCode) &&
      parent.arguments.length === 1 &&
      parent.arguments[0] === identifier
    );
  });
}

/** True for an array literal (possibly behind a `const` that never changes) of string or number literals only. */
function isLiteralList(node: TSESTree.Node, sourceCode: SourceCode): boolean {
  const resolved = resolveConst(node, sourceCode);
  return (
    resolved.type === AST_NODE_TYPES.ArrayExpression &&
    resolved.elements.length > 0 &&
    resolved.elements.every((element) => element !== null && isStaticLiteral(element)) &&
    isUnchangedConst(node, LIST_READS, sourceCode)
  );
}

/** True for `new Set([...literals])`, inline or behind a `const` that never changes. */
function isLiteralSet(node: TSESTree.Node, sourceCode: SourceCode): boolean {
  const resolved = resolveConst(node, sourceCode);
  return (
    isUnchangedConst(node, SET_READS, sourceCode) &&
    resolved.type === AST_NODE_TYPES.NewExpression &&
    isGlobal(resolved.callee, 'Set', sourceCode) &&
    resolved.arguments.length === 1 &&
    resolved.arguments[0] !== undefined &&
    resolved.arguments[0].type !== AST_NODE_TYPES.SpreadElement &&
    isLiteralList(resolved.arguments[0], sourceCode)
  );
}

/** The regex literal an expression is, inline or behind a `const`. */
function regexOf(node: TSESTree.Node, sourceCode: SourceCode): { pattern: string; flags: string } | null {
  const resolved = resolveConst(node, sourceCode);
  if (resolved.type === AST_NODE_TYPES.Literal && 'regex' in resolved) {
    return resolved.regex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checks and guards
// ---------------------------------------------------------------------------

type RegexJudge = (pattern: string, flags: string) => boolean;

function readsVariable(node: TSESTree.Node, variable: Variable, sourceCode: SourceCode): boolean {
  return subjectVariable(node, sourceCode) === variable;
}

function memberCall(node: TSESTree.Node, method: string): TSESTree.CallExpression | null {
  const inner = unwrap(node);
  return inner.type === AST_NODE_TYPES.CallExpression &&
    inner.callee.type === AST_NODE_TYPES.MemberExpression &&
    !inner.callee.computed &&
    inner.callee.property.type === AST_NODE_TYPES.Identifier &&
    inner.callee.property.name === method &&
    inner.arguments.length === 1 &&
    inner.arguments[0]?.type !== AST_NODE_TYPES.SpreadElement
    ? inner
    : null;
}

/**
 * `x === 'lit'` or `'lit' === x` (`!==` when `negated`). Loose `==` / `!=`
 * counts only against a string literal: `' 1\n' == 1` is true.
 */
function isLiteralComparison(
  node: TSESTree.Node,
  variable: Variable,
  negated: boolean,
  sourceCode: SourceCode,
): boolean {
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.BinaryExpression) {
    return false;
  }
  const strict = negated ? '!==' : '===';
  const loose = negated ? '!=' : '==';
  if (inner.operator !== strict && inner.operator !== loose) {
    return false;
  }
  const literalOk = (side: TSESTree.Node): boolean => {
    if (!isStaticLiteral(side)) {
      return false;
    }
    if (inner.operator === strict) {
      return true;
    }
    const value = unwrap(side);
    return value.type === AST_NODE_TYPES.TemplateLiteral || (value.type === AST_NODE_TYPES.Literal && typeof value.value === 'string');
  };
  return (
    (readsVariable(inner.left, variable, sourceCode) && literalOk(inner.right)) ||
    (readsVariable(inner.right, variable, sourceCode) && literalOk(inner.left))
  );
}

/** A positive check on `variable`: true only when the value passed it. */
function isCheck(node: TSESTree.Node, variable: Variable, judge: RegexJudge, sourceCode: SourceCode): boolean {
  const inner = unwrap(node);
  const includes = memberCall(inner, 'includes');
  if (
    includes !== null &&
    includes.callee.type === AST_NODE_TYPES.MemberExpression &&
    readsVariable(includes.arguments[0] as TSESTree.Node, variable, sourceCode) &&
    isLiteralList(includes.callee.object, sourceCode)
  ) {
    return true;
  }
  const has = memberCall(inner, 'has');
  if (
    has !== null &&
    has.callee.type === AST_NODE_TYPES.MemberExpression &&
    readsVariable(has.arguments[0] as TSESTree.Node, variable, sourceCode) &&
    isLiteralSet(has.callee.object, sourceCode)
  ) {
    return true;
  }
  const test = memberCall(inner, 'test');
  if (
    test !== null &&
    test.callee.type === AST_NODE_TYPES.MemberExpression &&
    readsVariable(test.arguments[0] as TSESTree.Node, variable, sourceCode)
  ) {
    const regex = regexOf(test.callee.object, sourceCode);
    return regex !== null && judge(regex.pattern, regex.flags);
  }
  return isLiteralComparison(inner, variable, false, sourceCode);
}

function flattenLogical(node: TSESTree.Node, operator: '&&' | '||'): TSESTree.Node[] {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.LogicalExpression && inner.operator === operator) {
    return [...flattenLogical(inner.left, operator), ...flattenLogical(inner.right, operator)];
  }
  return [inner];
}

/** A test that is true whenever the check failed: `!check`, `a !== 'x' && a !== 'y'`, `!check || other`. */
function failsUnlessChecked(
  node: TSESTree.Node,
  variable: Variable,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  return flattenLogical(node, '||').some((term) => {
    if (term.type === AST_NODE_TYPES.UnaryExpression && term.operator === '!') {
      return isCheck(term.argument, variable, judge, sourceCode);
    }
    const conjuncts = flattenLogical(term, '&&');
    return conjuncts.every((conjunct) => isLiteralComparison(conjunct, variable, true, sourceCode));
  });
}

/** A test that is true only when the check passed: `check`, `a === 'x' || a === 'y'`, `check && other`. */
function holdsOnlyIfChecked(
  node: TSESTree.Node,
  variable: Variable,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  return flattenLogical(node, '&&').some((term) => {
    const disjuncts = flattenLogical(term, '||');
    return disjuncts.length === 1
      ? isCheck(term, variable, judge, sourceCode)
      : disjuncts.every((disjunct) => isLiteralComparison(disjunct, variable, false, sourceCode));
  });
}

function exitsBlock(node: TSESTree.Statement): boolean {
  switch (node.type) {
    case AST_NODE_TYPES.ReturnStatement:
    case AST_NODE_TYPES.ThrowStatement:
    case AST_NODE_TYPES.BreakStatement:
    case AST_NODE_TYPES.ContinueStatement:
      return true;
    case AST_NODE_TYPES.BlockStatement: {
      const last = node.body.at(-1);
      return last !== undefined && exitsBlock(last);
    }
    default:
      return false;
  }
}

type GuardTest = (test: TSESTree.Expression, negated: boolean) => boolean;

/**
 * True when a guard runs before `sink` on every path to it: an `if` that
 * exits, before the sink in an enclosing block, whose test is true when the
 * value failed (`negated`); or an `if` around the sink whose test passed. Only
 * blocks of the function that holds the sink are searched.
 * `writesEndBefore(position)` says whether the checked bindings are no longer
 * written after a guard at `position`.
 */
function guardedBefore(
  sink: TSESTree.Node,
  isGuard: GuardTest,
  writesEndBefore: (position: number) => boolean,
): boolean {
  let child: TSESTree.Node = sink;
  for (let parent = sink.parent; parent != null; child = parent, parent = parent.parent) {
    if (
      parent.type === AST_NODE_TYPES.FunctionDeclaration ||
      parent.type === AST_NODE_TYPES.FunctionExpression ||
      parent.type === AST_NODE_TYPES.ArrowFunctionExpression
    ) {
      // A function can run before the checks that surround its definition
      // (a hoisted declaration, a callback stored and called later).
      return false;
    }
    if (
      parent.type === AST_NODE_TYPES.BlockStatement ||
      parent.type === AST_NODE_TYPES.Program ||
      parent.type === AST_NODE_TYPES.StaticBlock ||
      parent.type === AST_NODE_TYPES.SwitchCase
    ) {
      const body: readonly TSESTree.Node[] =
        parent.type === AST_NODE_TYPES.SwitchCase ? parent.consequent : parent.body;
      const index = body.indexOf(child);
      for (let i = 0; i < index; i += 1) {
        const statement = body[i];
        if (
          statement?.type === AST_NODE_TYPES.IfStatement &&
          statement.alternate === null &&
          exitsBlock(statement.consequent) &&
          writesEndBefore(statement.range[0]) &&
          isGuard(statement.test, true)
        ) {
          return true;
        }
      }
    }
    if (parent.type === AST_NODE_TYPES.IfStatement && writesEndBefore(parent.range[0])) {
      if (child === parent.consequent && isGuard(parent.test, false)) {
        return true;
      }
      if (child === parent.alternate && isGuard(parent.test, true)) {
        return true;
      }
    }
  }
  return false;
}

/** True when `variable` holds a value checked against `judge` before `sink`. */
function variableGuarded(
  variable: Variable,
  readAt: number,
  sink: TSESTree.Node,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  return guardedBefore(
    sink,
    (test, negated) =>
      negated
        ? failsUnlessChecked(test, variable, judge, sourceCode)
        : holdsOnlyIfChecked(test, variable, judge, sourceCode),
    // The value read at `readAt` is the checked one only if nothing wrote it
    // after the check or after the read (`const copy = x; x = y; check(x)`).
    (position) => writtenOnlyBefore(variable, Math.min(position, readAt)),
  );
}

// ---------------------------------------------------------------------------
// Schema validation (joi `validate`, zod `parse`)
// ---------------------------------------------------------------------------

const SCHEMA_PATTERN_METHODS: ReadonlySet<string> = new Set(['pattern', 'regex']);
const SCHEMA_LITERAL_METHODS: ReadonlySet<string> = new Set(['valid', 'enum', 'literal']);
/**
 * Methods known only to narrow what a joi or zod schema accepts (or to trim or
 * change case, which only removes or maps characters). Any other method in the
 * chain (`default`, `catch`, `failover`, `pipe`, `transform`, `allow`, `or`,
 * `custom`, ...) can let another value through, so the chain is not read.
 */
const SCHEMA_NARROWING_METHODS: ReadonlySet<string> = new Set([
  // constructors
  'string',
  'number',
  'boolean',
  // presence and labels
  'required',
  'optional',
  'nullable',
  'nonempty',
  'label',
  'description',
  'describe',
  'messages',
  'message',
  'strict',
  'readonly',
  'brand',
  // narrowing checks
  'min',
  'max',
  'length',
  'alphanum',
  'token',
  'hex',
  'guid',
  'uuid',
  'cuid',
  'cuid2',
  'ulid',
  'integer',
  'int',
  'positive',
  'negative',
  'nonnegative',
  'nonpositive',
  'finite',
  'safe',
  'invalid',
  'startsWith',
  'endsWith',
  // value maps that only remove or recase characters
  'trim',
  'lowercase',
  'uppercase',
  'toLowerCase',
  'toUpperCase',
]);

function isStringLiteral(node: TSESTree.Node | undefined): boolean {
  const inner = node === undefined ? null : unwrap(node);
  return inner?.type === AST_NODE_TYPES.Literal && typeof inner.value === 'string';
}

/**
 * True when a schema chain can only accept values `judge` approves: every
 * method is a constructor, a narrowing check, a `pattern` / `regex` the judge
 * approves (with no options argument, which could be `{ invert: true }`; a
 * string name or message is fine), or `valid` / `enum` / `literal` of literals.
 */
function schemaConfines(node: TSESTree.Node, judge: RegexJudge, sourceCode: SourceCode): boolean {
  let current = resolveConst(node, sourceCode);
  let confined = false;
  for (let depth = 0; depth < 16 && current.type === AST_NODE_TYPES.CallExpression; depth += 1) {
    const callee = current.callee;
    if (
      callee.type !== AST_NODE_TYPES.MemberExpression ||
      callee.computed ||
      callee.property.type !== AST_NODE_TYPES.Identifier
    ) {
      return false;
    }
    const method = callee.property.name;
    const args = current.arguments;
    if (SCHEMA_PATTERN_METHODS.has(method)) {
      const regex = args[0] === undefined ? null : regexOf(args[0], sourceCode);
      if (
        regex === null ||
        !judge(regex.pattern, regex.flags) ||
        args.length > 2 ||
        (args.length === 2 && !isStringLiteral(args[1]))
      ) {
        return false;
      }
      confined = true;
    } else if (SCHEMA_LITERAL_METHODS.has(method)) {
      const literal =
        args.length > 0 &&
        args.every(
          (arg) =>
            arg.type !== AST_NODE_TYPES.SpreadElement && (isStaticLiteral(arg) || isLiteralList(arg, sourceCode)),
        );
      if (!literal) {
        return false;
      }
      confined = true;
    } else if (!SCHEMA_NARROWING_METHODS.has(method)) {
      return false;
    }
    current = unwrap(callee.object);
  }
  return confined && current.type === AST_NODE_TYPES.Identifier;
}

/** `schema.parse(x)` (throws on failure) whose schema is confined. */
function isConfinedParse(node: TSESTree.Node, judge: RegexJudge, sourceCode: SourceCode): boolean {
  const call = memberCall(node, 'parse');
  return (
    call !== null &&
    call.callee.type === AST_NODE_TYPES.MemberExpression &&
    schemaConfines(call.callee.object, judge, sourceCode)
  );
}

/**
 * `const { error, value } = schema.validate(x)` followed by an exiting
 * `if (error)` before the sink, with a confined schema.
 */
function isConfinedValidateValue(
  variable: Variable,
  sink: TSESTree.Node,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  const def = variable.defs[0];
  if (variable.defs.length !== 1 || def?.type !== 'Variable' || def.parent.kind !== 'const') {
    return false;
  }
  const pattern = def.node.id;
  const init = def.node.init;
  if (pattern.type !== AST_NODE_TYPES.ObjectPattern || init === null) {
    return false;
  }
  const call = memberCall(init, 'validate');
  if (
    call === null ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    !schemaConfines(call.callee.object, judge, sourceCode)
  ) {
    return false;
  }
  let valueBinding: string | null = null;
  let errorBinding: TSESTree.Identifier | null = null;
  for (const property of pattern.properties) {
    if (
      property.type !== AST_NODE_TYPES.Property ||
      property.computed ||
      property.key.type !== AST_NODE_TYPES.Identifier
    ) {
      continue;
    }
    if (property.value.type !== AST_NODE_TYPES.Identifier) {
      continue;
    }
    if (property.key.name === 'value') {
      valueBinding = property.value.name;
    } else if (property.key.name === 'error') {
      errorBinding = property.value;
    }
  }
  if (valueBinding !== variable.name || errorBinding === null) {
    return false;
  }
  const errorVariable = variableOf(errorBinding, sourceCode);
  if (errorVariable === null) {
    return false;
  }
  return guardedBefore(
    sink,
    (test, negated) => {
      const inner = unwrap(test);
      return (
        negated &&
        inner.type === AST_NODE_TYPES.Identifier &&
        variableOf(inner, sourceCode) === errorVariable
      );
    },
    () => true,
  );
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/** Options for {@link isProvenSafeValue}. */
export interface ProvenSafeOptions {
  /**
   * Also accept values read from `process.env` with a fixed key, which the
   * operator sets, not the requester. Off by default: in CI some variables
   * carry text an outsider chose (`GITHUB_HEAD_REF`, a pull request title).
   */
  readonly trustEnvironment?: boolean;
}

/**
 * True when `node`, used at `sink`, is proven harmless for `context`: a
 * literal or in-file `const` literal, a value guarded before the sink (see the
 * header), a confined schema's output, or (with `trustEnvironment`) a value
 * read from `process.env`. Followed through `const` aliases and `String(x)`.
 */
export function isProvenSafeValue(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  context: GuardContext,
  sourceCode: SourceCode,
  options: ProvenSafeOptions = {},
): boolean {
  const judge: RegexJudge = (pattern, flags) => regexAdmitsOnlySafe(pattern, flags, context);
  return provenSafe(node, sink, judge, sourceCode, options, 0);
}

function provenSafe(
  raw: TSESTree.Node,
  sink: TSESTree.Node,
  judge: RegexJudge,
  sourceCode: SourceCode,
  options: ProvenSafeOptions,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const node = peelStringWrappers(raw, sourceCode);
  if (isStaticLiteral(node)) {
    return true;
  }
  if (options.trustEnvironment === true && isEnvironmentValue(node, sourceCode, 0)) {
    return true;
  }
  if (isConfinedParse(node, judge, sourceCode)) {
    return true;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(node, sourceCode);
  if (variable === null) {
    return false;
  }
  if (
    variableGuarded(variable, node.range[0], sink, judge, sourceCode) ||
    isConfinedValidateValue(variable, sink, judge, sourceCode)
  ) {
    return true;
  }
  const init = constInit(variable);
  return init !== null && provenSafe(init, sink, judge, sourceCode, options, depth + 1);
}

const ENV_PRESERVING_METHODS: ReadonlySet<string> = new Set([
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'replace',
  'replaceAll',
  'normalize',
  'toString',
]);

/** `process.env.X` or `process.env['X']`; a computed key (`process.env[name]`) is not read. */
function isProcessEnvRead(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    (!node.computed || isStringLiteral(node.property)) &&
    node.object.type === AST_NODE_TYPES.MemberExpression &&
    !node.object.computed &&
    node.object.object.type === AST_NODE_TYPES.Identifier &&
    node.object.object.name === 'process' &&
    node.object.property.type === AST_NODE_TYPES.Identifier &&
    node.object.property.name === 'env'
  );
}

/**
 * A value read from `process.env`, through `const` bindings, `String()`,
 * string methods with literal arguments, literal fallbacks and templates or
 * concatenations of such values and literals.
 */
function isEnvironmentValue(raw: TSESTree.Node, sourceCode: SourceCode, depth: number): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const node = peelStringWrappers(raw);
  const next = (child: TSESTree.Node): boolean =>
    isStaticLiteral(child) || isEnvironmentValue(child, sourceCode, depth + 1);
  if (isProcessEnvRead(node)) {
    return true;
  }
  switch (node.type) {
    case AST_NODE_TYPES.Identifier: {
      const variable = variableOf(node, sourceCode);
      const init = variable === null ? null : constInit(variable);
      if (init !== null) {
        return next(init);
      }
      // `const { value } = schema.validate(x)` passes `x` through.
      const def = variable?.defs[0];
      if (
        variable?.defs.length === 1 &&
        def?.type === 'Variable' &&
        def.parent.kind === 'const' &&
        def.node.id.type === AST_NODE_TYPES.ObjectPattern &&
        def.node.init !== null
      ) {
        const call = memberCall(def.node.init, 'validate');
        const valueProperty = def.node.id.properties.some(
          (property) =>
            property.type === AST_NODE_TYPES.Property &&
            !property.computed &&
            property.key.type === AST_NODE_TYPES.Identifier &&
            property.key.name === 'value' &&
            property.value.type === AST_NODE_TYPES.Identifier &&
            property.value.name === variable.name,
        );
        return call !== null && valueProperty && next(call.arguments[0] as TSESTree.Node);
      }
      return false;
    }
    case AST_NODE_TYPES.LogicalExpression:
      return next(node.left) && next(node.right);
    case AST_NODE_TYPES.ConditionalExpression:
      return next(node.consequent) && next(node.alternate);
    case AST_NODE_TYPES.TemplateLiteral:
      return node.expressions.every(next);
    case AST_NODE_TYPES.BinaryExpression:
      return node.operator === '+' && next(node.left) && next(node.right);
    case AST_NODE_TYPES.CallExpression: {
      const callee = node.callee;
      return (
        callee.type === AST_NODE_TYPES.MemberExpression &&
        !callee.computed &&
        callee.property.type === AST_NODE_TYPES.Identifier &&
        ENV_PRESERVING_METHODS.has(callee.property.name) &&
        node.arguments.every((arg) => arg.type !== AST_NODE_TYPES.SpreadElement && isPlainLiteral(arg)) &&
        next(callee.object)
      );
    }
    default:
      return false;
  }
}

function isPlainLiteral(node: TSESTree.Node): boolean {
  return unwrap(node).type === AST_NODE_TYPES.Literal || isStaticLiteral(node);
}

/** The URL fields whose value names a host and nothing the requester can extend. */
const HOST_FIELDS: ReadonlySet<string> = new Set(['hostname', 'host', 'origin']);

/** `new URL(x)` with one argument, else null. */
function singleArgumentUrl(node: TSESTree.Node): TSESTree.Node | null {
  const inner = unwrap(node);
  return inner.type === AST_NODE_TYPES.NewExpression &&
    inner.callee.type === AST_NODE_TYPES.Identifier &&
    inner.callee.name === 'URL' &&
    inner.arguments.length === 1 &&
    inner.arguments[0]?.type !== AST_NODE_TYPES.SpreadElement
    ? (inner.arguments[0] as TSESTree.Node)
    : null;
}

/** For `new URL(x).hostname` (or `.host` / `.origin`), the `x`; else null. */
export function hostFieldSubject(node: TSESTree.Node): TSESTree.Node | null {
  const inner = unwrap(node);
  if (
    inner.type !== AST_NODE_TYPES.MemberExpression ||
    inner.computed ||
    inner.property.type !== AST_NODE_TYPES.Identifier ||
    !HOST_FIELDS.has(inner.property.name)
  ) {
    return null;
  }
  return singleArgumentUrl(inner.object);
}

/**
 * The bindings that hold `new URL(<variable>).hostname`: every write to such a
 * binding is that read or a literal (`let host = ''`). Returns each with the
 * position of its URL read.
 */
function hostBindingsOf(variable: Variable, sourceCode: SourceCode): { binding: Variable; readEnd: number }[] {
  const found: { binding: Variable; readEnd: number }[] = [];
  for (const reference of variable.references) {
    if (!reference.isRead()) {
      continue;
    }
    // Climb `String(x)` / `${x}` to the `new URL(...)` argument.
    let node: TSESTree.Node = reference.identifier;
    while (
      node.parent != null &&
      node.parent.type !== AST_NODE_TYPES.NewExpression &&
      peelStringWrappers(node.parent) === peelStringWrappers(node)
    ) {
      node = node.parent;
    }
    const newUrl = node.parent;
    if (newUrl?.type !== AST_NODE_TYPES.NewExpression || singleArgumentUrl(newUrl) !== node) {
      continue;
    }
    const field = newUrl.parent;
    if (field === undefined || hostFieldSubject(field) !== node) {
      continue;
    }
    const holder = field.parent;
    let target: TSESTree.Identifier | null = null;
    if (
      holder?.type === AST_NODE_TYPES.VariableDeclarator &&
      holder.init === field &&
      holder.id.type === AST_NODE_TYPES.Identifier
    ) {
      target = holder.id;
    } else if (
      holder?.type === AST_NODE_TYPES.AssignmentExpression &&
      holder.operator === '=' &&
      holder.right === field &&
      holder.left.type === AST_NODE_TYPES.Identifier
    ) {
      target = holder.left;
    }
    const binding = target === null ? null : variableOf(target, sourceCode);
    if (binding === null) {
      continue;
    }
    const onlyThisOrLiterals = binding.references.every((ref) => {
      if (!ref.isWrite()) {
        return true;
      }
      const written = ref.writeExpr;
      return written === field || (written !== null && written !== undefined && isStaticLiteral(written));
    });
    if (onlyThisOrLiterals) {
      found.push({ binding, readEnd: field.range[1] });
    }
  }
  return found;
}

/**
 * True when the URL `node`, used at `sink`, is host-pinned: its host was read
 * with `new URL(url).hostname` (or `.host` / `.origin`) into a binding that an
 * allowlist check guarded before the sink, and the URL was not written after
 * that read. `new URL(pinned).hostname` itself is pinned too. Followed through
 * `const` aliases and `String(x)`.
 */
export function isHostPinned(node: TSESTree.Node, sink: TSESTree.Node, sourceCode: SourceCode): boolean {
  return hostPinned(node, sink, sourceCode, 0);
}

function hostPinned(raw: TSESTree.Node, sink: TSESTree.Node, sourceCode: SourceCode, depth: number): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const field = hostFieldSubject(peelStringWrappers(raw));
  const node = peelStringWrappers(field ?? raw);
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(node, sourceCode);
  if (variable === null) {
    return false;
  }
  for (const { binding, readEnd } of hostBindingsOf(variable, sourceCode)) {
    const guarded = guardedBefore(
      sink,
      (test, negated) =>
        negated
          ? failsUnlessChecked(test, binding, regexPinsHost, sourceCode)
          : holdsOnlyIfChecked(test, binding, regexPinsHost, sourceCode),
      (position) =>
        writtenOnlyBefore(binding, position) &&
        writtenOnlyBefore(variable, Math.min(position, readEnd)),
    );
    if (guarded) {
      return true;
    }
  }
  const init = constInit(variable);
  return init !== null && hostPinned(init, sink, sourceCode, depth + 1);
}
