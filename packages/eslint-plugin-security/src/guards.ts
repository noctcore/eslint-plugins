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
 * function may write it at all, so it cannot change after the check; a binding
 * declared outside the checking function must never be written after its
 * declaration. Changes through an alias or `Object.assign` count as writes. An
 * allowlist counts only when it never changes: a `const` array or `Set` of
 * literals, not exported, whose every use is an `includes` / `has` call (or,
 * for an array, `new Set(list)`). `const` aliases (`const safe = checked`) and
 * the global `String(x)` are seen through.
 *
 * A URL is host-pinned when `new URL(url).hostname` (or `.host` / `.origin`) was
 * read into a binding and that binding passed an allowlist the same way, with
 * a regex that ends in a literal domain (`^(app|docs)\.example\.com$`).
 */

/**
 * Characters a shell value must not start with: a leading `-` turns the value
 * into an option (argument injection, CWE-88) and a leading `#` comments out
 * the rest of the line.
 */
const SHELL_LEADING = '-#';

/**
 * Where a value lands, which decides the characters a regex may admit.
 * `shell-word` is a shell value glued to text before it in the same word
 * (`--author=${x}`), where a leading `-` or `#` is not an option or a comment.
 * `command` is a shell value in the program-name position, which no regex or
 * schema pattern proves, only a literal allowlist or a constant.
 */
export type GuardContext = 'shell' | 'shell-word' | 'command' | 'html' | 'path';

const SHELL_UNSAFE = ';&|$`()<>{}[]*?!~\'"\\^\n\r \t\v\f';
/** Characters each context must never receive from a value it cannot see. */
const UNSAFE_CHARACTERS: Readonly<Record<GuardContext, string>> = {
  // Command separators, substitution, quoting, redirection, globbing,
  // escapes and whitespace (which splits one value into several arguments).
  // A leading `-` or `#` is refused apart (see `SHELL_LEADING`).
  shell: SHELL_UNSAFE,
  'shell-word': SHELL_UNSAFE,
  command: SHELL_UNSAFE,
  html: '<>&"\'`',
  // Separators (and a drive letter's `:`) are what move a path elsewhere.
  path: '/\\:\0',
};

const MAX_DEPTH = 8;

type SourceCode = Readonly<TSESLint.SourceCode>;
type Variable = TSESLint.Scope.Variable;
type Scope = TSESLint.Scope.Scope;
type Reference = TSESLint.Scope.Reference;

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
  /** For `quantifier`: true when it allows zero repetitions (`*`, `?`, `{0,n}`). */
  readonly optional?: boolean;
}

/** A `\xHH` or `\uHHHH` escape at `index`: the character and the escape's length. */
function hexEscape(text: string, index: number): { char: string; length: number } | null {
  const match = /^\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4}))/u.exec(text.slice(index));
  if (match === null) {
    return null;
  }
  return {
    char: String.fromCodePoint(Number.parseInt(match[1] ?? match[2] ?? '', 16)),
    length: match[0].length,
  };
}

/** Splits a pattern into tokens; null for syntax this reader does not handle. */
/**
 * Unicode property escapes that admit only letters, marks or digits, never
 * ASCII punctuation or whitespace. Read with the `u` flag only.
 */
const LETTER_PROPERTIES: ReadonlySet<string> = new Set([
  'L',
  'Letter',
  'Lu',
  'Ll',
  'Lt',
  'Lm',
  'Lo',
  'M',
  'Mark',
  'Mn',
  'Mc',
  'N',
  'Number',
  'Nd',
  'Alphabetic',
  'Alpha',
  'Script=Latin',
  'sc=Latin',
]);

/**
 * For `\p{Letter}`-style escapes at `index` (with the `u` flag), the
 * characters it stands for (a letter, as a representative: none of these is
 * unsafe anywhere) and its length; null for other escapes.
 */
function propertyEscape(
  text: string,
  index: number,
  unicode: boolean,
): { chars: string; length: number } | null {
  if (!unicode || !text.startsWith('\\p{', index)) {
    return null;
  }
  const close = text.indexOf('}', index);
  if (close === -1 || !LETTER_PROPERTIES.has(text.slice(index + 3, close))) {
    return null;
  }
  return { chars: 'a', length: close + 1 - index };
}

/** A `{n}` or `{n,m}` count whose lower bound is zero, however many zeros it is written with. */
const OPTIONAL_COUNT = /^\{0+(?:,\d*)?\}/u;

function tokenize(pattern: string, unicode = false): RegexToken[] | null {
  const tokens: RegexToken[] = [];
  let i = 0;
  while (i < pattern.length) {
    const char = pattern.charAt(i);
    if (char === '\\') {
      const property = propertyEscape(pattern, i, unicode);
      if (property !== null) {
        tokens.push({ kind: 'chars', chars: property.chars });
        i += property.length;
        continue;
      }
      const hex = hexEscape(pattern, i);
      if (hex !== null) {
        tokens.push({ kind: 'chars', chars: hex.char, literal: true });
        i += hex.length;
        continue;
      }
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
      const chars = classCharacters(pattern.slice(i + 1, end), unicode);
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
      tokens.push({ kind: 'quantifier', optional: char !== '+' });
      i += 1;
    } else if (char === '{') {
      const match = /^\{\d+(,\d*)?\}/u.exec(pattern.slice(i));
      if (match === null) {
        tokens.push({ kind: 'chars', chars: '{', literal: true });
        i += 1;
      } else {
        // `{0}`, `{00}` and `{0,n}` all allow zero repetitions.
        tokens.push({ kind: 'quantifier', optional: OPTIONAL_COUNT.test(match[0]) });
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
function classCharacters(body: string, unicode = false): string | null {
  if (body.startsWith('^')) {
    return null;
  }
  const singles: string[] = [];
  let i = 0;
  while (i < body.length) {
    let first: string;
    const property = propertyEscape(body, i, unicode);
    if (property !== null) {
      singles.push(property.chars);
      i += property.length;
      continue;
    }
    const hex = hexEscape(body, i);
    if (hex !== null) {
      first = hex.char;
      i += hex.length;
    } else if (body.charAt(i) === '\\') {
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
      const lastHex = hexEscape(body, i + 1);
      if (lastHex !== null) {
        last = lastHex.char;
        i += 1 + lastHex.length;
      } else if (body.charAt(i + 1) === '\\') {
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
  const tokens = tokenize(pattern, flags.includes('u'));
  if (tokens === null || tokens.length < 2) {
    return null;
  }
  const first = tokens[0];
  const last = tokens.at(-1);
  if (
    first?.kind !== 'anchor' ||
    first.chars !== '^' ||
    last?.kind !== 'anchor' ||
    last.chars !== '$'
  ) {
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
 * Whole values a context must never receive, whatever their characters. An
 * empty shell value drops out of the command (`rm -rf /srv/${x}` with `x = ''`
 * removes `/srv/`, and an empty unquoted argument shifts the ones after it); a
 * path segment of `.` or `..` (or empty) names the directory itself or its parent.
 */
const FORBIDDEN_VALUES: Readonly<Record<GuardContext, readonly string[]>> = {
  shell: [''],
  'shell-word': [''],
  command: [''],
  html: [],
  path: ['', '.', '..'],
};

/**
 * True when the regex accepts one of `values`, tried on the compiled regex
 * itself (without `g` or `y`, which would make the test depend on
 * `lastIndex`). A pattern that does not compile here counts as accepting.
 */
function matchesAny(pattern: string, flags: string, values: readonly string[]): boolean {
  if (values.length === 0) {
    return false;
  }
  try {
    const regex = new RegExp(pattern, flags.replace(/[gy]/gu, ''));
    return values.some((value) => regex.test(value));
  } catch {
    return true;
  }
}

/**
 * True when every string the regex accepts is made only of characters that are
 * harmless in `context`: anchored `^...$`, no `m` flag, no `.`, and no class or
 * escape that admits an unsafe character.
 */
export function regexAdmitsOnlySafe(
  pattern: string,
  flags: string,
  context: GuardContext,
): boolean {
  if (context === 'command') {
    // A program name is proven only by a literal allowlist: any regex that
    // admits `reboot` or `sh` lets the requester pick the program.
    return false;
  }
  const body = anchoredBody(pattern, flags);
  if (body === null) {
    return false;
  }
  const unsafe = UNSAFE_CHARACTERS[context];
  const admitsOnlySafe = body.every(
    (token) =>
      token.kind !== 'any' &&
      token.kind !== 'unknown' &&
      (token.kind !== 'chars' || ![...(token.chars ?? '')].some((char) => unsafe.includes(char))),
  );
  if (!admitsOnlySafe || matchesAny(pattern, flags, FORBIDDEN_VALUES[context])) {
    return false;
  }
  if (context !== 'shell') {
    return true;
  }
  const admitsLeading = body.some(
    (token) =>
      token.kind === 'chars' && [...(token.chars ?? '')].some((c) => SHELL_LEADING.includes(c)),
  );
  if (!admitsLeading) {
    return true;
  }
  const first = firstCharacters(body);
  return first !== null && ![...first].some((char) => SHELL_LEADING.includes(char));
}

/**
 * Every character an anchored body can start with, or null when its start is
 * not a plain run of character tokens (a group or an alternation).
 */
function firstCharacters(body: readonly RegexToken[]): string | null {
  let chars = '';
  let i = 0;
  while (i < body.length) {
    const token = body[i];
    if (token?.kind !== 'chars') {
      return null;
    }
    chars += token.chars ?? '';
    const next = body[i + 1];
    if (next?.kind !== 'quantifier' || next.optional !== true) {
      return chars;
    }
    i += 2;
  }
  return chars;
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
    current =
      current.type === AST_NODE_TYPES.AwaitExpression ? current.argument : current.expression;
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
 *
 * `scope` is the function scope the check and the sink run in. When it is not
 * the one that declares the binding (a closure reads an outer `let`), the
 * check's function can run at any point of its parent's run: hoisted above the
 * writes, or resumed after an `await` while the parent writes again. Source
 * order then says nothing, so the binding must never change after its `let` or
 * `const` declaration (a `var` can be read before its initializer runs). In a
 * sloppy-mode function, `arguments[0] = y` writes the first parameter, so a
 * parameter of a function that uses `arguments` is never taken as unchanged.
 */
function writtenOnlyBefore(variable: Variable, position: number, scope: Scope | null): boolean {
  const home = variable.scope.variableScope;
  if (argumentsAliased(variable)) {
    return false;
  }
  if (scope !== home) {
    const def = variable.defs[0];
    const declaredOnce = def?.type !== 'Variable' || def.parent.kind !== 'var';
    return variable.references.every(
      (reference) =>
        (!reference.isWrite() || (reference.init === true && declaredOnce)) &&
        contentChanges(reference)?.length === 0,
    );
  }
  const before = (reference: Reference): boolean =>
    reference.from.variableScope === home && reference.identifier.range[1] <= position;
  return variable.references.every((reference) => {
    if (reference.isWrite() && !before(reference)) {
      return false;
    }
    const changes = contentChanges(reference);
    return changes !== null && changes.every(before);
  });
}

/**
 * True for a parameter of a sloppy-mode function that reads `arguments`,
 * where the two alias each other: `arguments[0] = y` changes the parameter.
 */
function argumentsAliased(variable: Variable): boolean {
  const home = variable.scope;
  if (home.isStrict || !variable.defs.some((def) => def.type === 'Parameter')) {
    return false;
  }
  const args = home.set.get('arguments');
  return args !== undefined && args.references.length > 0;
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

/** `Object.<name>` / `Reflect.<name>` functions that change their first argument. */
const OBJECT_WRITERS: Readonly<Record<string, ReadonlySet<string>>> = {
  Object: new Set(['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']),
  Reflect: new Set(['set', 'defineProperty', 'deleteProperty', 'setPrototypeOf']),
};

/** True for a call such as `Object.assign(x, ...)` whose first argument is `node`. */
function isObjectWriterTarget(node: TSESTree.Node, call: TSESTree.Node | undefined): boolean {
  if (
    call?.type !== AST_NODE_TYPES.CallExpression ||
    call.arguments[0] !== node ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    call.callee.computed ||
    call.callee.object.type !== AST_NODE_TYPES.Identifier ||
    call.callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  return OBJECT_WRITERS[call.callee.object.name]?.has(call.callee.property.name) === true;
}

/**
 * True when the binding was given an array, object or `new` value somewhere
 * (`const parts = [x]`): a container whose contents a helper can change.
 */
function holdsContainer(variable: Variable): boolean {
  return variable.references.some((reference) => {
    const value = reference.writeExpr;
    return (
      value?.type === AST_NODE_TYPES.ArrayExpression ||
      value?.type === AST_NODE_TYPES.ObjectExpression ||
      value?.type === AST_NODE_TYPES.NewExpression
    );
  });
}

/**
 * The references that change what the binding holds without assigning it,
 * reached from `reference`: `x.push(y)`, `x[0] = y`, `x.length = 0`, `x.n++`,
 * `Object.assign(x, y)`, or the same through an alias (`const p = x;
 * p.push(y)` yields the `p` of `p.push`). For a binding known to hold a
 * container, handing it to a function (`mutate(x)`), storing it in an array,
 * an object or a member, destructuring it, or yielding it also counts: the
 * other side can change it. Empty when the reference changes nothing, null
 * when it cannot be told. A checked array changed after the check no longer
 * holds the checked text.
 */
function contentChanges(reference: Reference, depth = 0): Reference[] | null {
  if (depth > MAX_DEPTH) {
    return null;
  }
  const identifier = reference.identifier;
  const parent = identifier.parent;
  if (parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === identifier) {
    const use = parent.parent;
    const changes =
      (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === parent) ||
      (use.type === AST_NODE_TYPES.UpdateExpression && use.argument === parent) ||
      (use.type === AST_NODE_TYPES.CallExpression &&
        use.callee === parent &&
        !parent.computed &&
        parent.property.type === AST_NODE_TYPES.Identifier &&
        MUTATING_METHODS.has(parent.property.name));
    return changes ? [reference] : [];
  }
  if (isObjectWriterTarget(identifier, parent)) {
    return [reference];
  }
  const container = reference.resolved !== null && holdsContainer(reference.resolved);
  // `const p = x` or `p = x`: what `p` does to the value, `x` does too.
  const aliasId =
    parent?.type === AST_NODE_TYPES.VariableDeclarator && parent.init === identifier
      ? parent.id
      : parent?.type === AST_NODE_TYPES.AssignmentExpression &&
          parent.operator === '=' &&
          parent.right === identifier
        ? parent.left
        : null;
  if (aliasId !== null && aliasId.type === AST_NODE_TYPES.Identifier) {
    const alias = ASTUtils.findVariable(reference.from, aliasId);
    if (alias === null) {
      return null;
    }
    const out: Reference[] = [];
    for (const aliasReference of alias.references) {
      const changes = contentChanges(aliasReference, depth + 1);
      if (changes === null) {
        return null;
      }
      out.push(...changes);
    }
    return out;
  }
  const escapes =
    aliasId !== null ||
    (parent?.type === AST_NODE_TYPES.CallExpression && parent.callee !== identifier) ||
    (parent?.type === AST_NODE_TYPES.NewExpression && parent.callee !== identifier) ||
    parent?.type === AST_NODE_TYPES.ArrayExpression ||
    (parent?.type === AST_NODE_TYPES.Property && parent.value === identifier) ||
    parent?.type === AST_NODE_TYPES.YieldExpression;
  return container && escapes ? [reference] : [];
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

/**
 * The identifiers {@link resolveConst} walks through from `node`, in order
 * (`B` then `A` for `const A = [...]; const B = A`). Each one is a name the
 * same array or `Set` can be changed through.
 */
function constChain(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.Identifier[] {
  const chain: TSESTree.Identifier[] = [];
  let current = unwrap(node);
  for (let depth = 0; depth < MAX_DEPTH && current.type === AST_NODE_TYPES.Identifier; depth += 1) {
    chain.push(current);
    const variable = variableOf(current, sourceCode);
    const init = variable === null ? null : constInit(variable);
    if (init === null) {
      break;
    }
    current = unwrap(init);
  }
  return chain;
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

const LIST_READS: ReadonlySet<string> = new Set(['includes', 'indexOf']);
const SET_READS: ReadonlySet<string> = new Set(['has']);

/**
 * True when an identifier names a `const` whose contents never change: it is
 * not exported, and every use of it is a read the caller allows (a `.includes`
 * / `.has` receiver, or the argument of `new Set(list)`). `const` fixes the
 * binding, not the array or `Set` it holds.
 */
function isUnchangedConst(
  node: TSESTree.Node,
  reads: ReadonlySet<string>,
  sourceCode: SourceCode,
): boolean {
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    // An inline literal cannot be reached by anything else.
    return true;
  }
  const variable = variableOf(inner, sourceCode);
  const def = variable?.defs[0];
  if (
    variable === null ||
    def?.type !== 'Variable' ||
    def.parent.parent.type === AST_NODE_TYPES.ExportNamedDeclaration
  ) {
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

/**
 * True when every `const` on the way from `node` to the literal is unchanged
 * ({@link isUnchangedConst}): with `const B = A`, a `A.push(x)` changes the
 * list `B.includes` reads. An alias is itself a use of `A` that is not a read,
 * so a list reached through one is refused, as a regex is.
 */
function isUnchangedChain(
  node: TSESTree.Node,
  reads: ReadonlySet<string>,
  sourceCode: SourceCode,
): boolean {
  const chain = constChain(node, sourceCode);
  return chain.length === 0
    ? isUnchangedConst(node, reads, sourceCode)
    : chain.every((identifier) => isUnchangedConst(identifier, reads, sourceCode));
}

/** True for an array literal (possibly behind a `const` that never changes) of string or number literals only. */
function isLiteralList(node: TSESTree.Node, sourceCode: SourceCode): boolean {
  const resolved = resolveConst(node, sourceCode);
  const frozen = frozenArgument(resolved, sourceCode);
  if (frozen !== null) {
    // `Object.freeze([...])`: the contents cannot change, whatever else reads the list.
    return (
      frozen.type === AST_NODE_TYPES.ArrayExpression &&
      frozen.elements.length > 0 &&
      frozen.elements.every((element) => element !== null && isStaticLiteral(element))
    );
  }
  return (
    resolved.type === AST_NODE_TYPES.ArrayExpression &&
    resolved.elements.length > 0 &&
    resolved.elements.every((element) => element !== null && isStaticLiteral(element)) &&
    isUnchangedChain(node, LIST_READS, sourceCode)
  );
}

/** For `Object.freeze(x)` with the global `Object`, the `x`; else null. */
function frozenArgument(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.Node | null {
  const inner = unwrap(node);
  return inner.type === AST_NODE_TYPES.CallExpression &&
    inner.callee.type === AST_NODE_TYPES.MemberExpression &&
    !inner.callee.computed &&
    isGlobal(inner.callee.object, 'Object', sourceCode) &&
    inner.callee.property.type === AST_NODE_TYPES.Identifier &&
    inner.callee.property.name === 'freeze' &&
    inner.arguments.length === 1 &&
    inner.arguments[0]?.type !== AST_NODE_TYPES.SpreadElement
    ? unwrap(inner.arguments[0] as TSESTree.Node)
    : null;
}

/** True for `new Set([...literals])`, inline or behind a `const` that never changes. */
function isLiteralSet(node: TSESTree.Node, sourceCode: SourceCode): boolean {
  const resolved = resolveConst(node, sourceCode);
  return (
    isUnchangedChain(node, SET_READS, sourceCode) &&
    resolved.type === AST_NODE_TYPES.NewExpression &&
    isGlobal(resolved.callee, 'Set', sourceCode) &&
    resolved.arguments.length === 1 &&
    resolved.arguments[0] !== undefined &&
    resolved.arguments[0].type !== AST_NODE_TYPES.SpreadElement &&
    isLiteralList(resolved.arguments[0], sourceCode)
  );
}

const REGEX_READS: ReadonlySet<string> = new Set(['test', 'exec']);
/** Calls that only read a regex passed to them. */
const REGEX_TAKING_METHODS: ReadonlySet<string> = new Set([
  'pattern',
  'regex',
  'match',
  'matchAll',
  'search',
  'replace',
  'replaceAll',
  'split',
]);

/**
 * True when a `const` regex binding never changes: not exported, and every use
 * is a `.test` / `.exec` call on it or an argument of a call that only reads
 * it (`.pattern(re)`, `s.match(re)`). `re.test = ...` or `re.compile(...)`
 * would change what the check does.
 */
function isUnchangedRegex(node: TSESTree.Identifier, sourceCode: SourceCode): boolean {
  const variable = variableOf(node, sourceCode);
  const def = variable?.defs[0];
  if (
    variable === null ||
    def?.type !== 'Variable' ||
    def.parent.parent.type === AST_NODE_TYPES.ExportNamedDeclaration
  ) {
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
    if (isMethodReceiver(identifier, REGEX_READS)) {
      return true;
    }
    const call = identifier.parent;
    return (
      call?.type === AST_NODE_TYPES.CallExpression &&
      call.arguments.includes(identifier as TSESTree.Expression) &&
      call.callee.type === AST_NODE_TYPES.MemberExpression &&
      !call.callee.computed &&
      call.callee.property.type === AST_NODE_TYPES.Identifier &&
      REGEX_TAKING_METHODS.has(call.callee.property.name)
    );
  });
}

/** The regex literal an expression is, inline or behind a `const` that never changes. */
function regexOf(
  node: TSESTree.Node,
  sourceCode: SourceCode,
): { pattern: string; flags: string } | null {
  let current = unwrap(node);
  for (let depth = 0; depth < MAX_DEPTH && current.type === AST_NODE_TYPES.Identifier; depth += 1) {
    const variable = variableOf(current, sourceCode);
    const init = variable === null ? null : constInit(variable);
    if (init === null || !isUnchangedRegex(current, sourceCode)) {
      return null;
    }
    current = unwrap(init);
  }
  if (current.type === AST_NODE_TYPES.Literal && 'regex' in current) {
    return current.regex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Checks and guards
// ---------------------------------------------------------------------------

type RegexJudge = (pattern: string, flags: string) => boolean;

/** What a check must be about: a binding, or any expression a predicate accepts. */
type Subject = Variable | ((node: TSESTree.Node) => boolean);

function readsVariable(node: TSESTree.Node, subject: Subject, sourceCode: SourceCode): boolean {
  return typeof subject === 'function'
    ? subject(unwrap(node))
    : subjectVariable(node, sourceCode) === subject;
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
  variable: Subject,
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
  const literalOk = (raw: TSESTree.Node): boolean => {
    // An in-file `const` string or number is as fixed as the literal itself.
    const side = resolveConst(raw, sourceCode);
    if (!isStaticLiteral(side)) {
      return false;
    }
    if (inner.operator === strict) {
      return true;
    }
    const value = unwrap(side);
    return (
      value.type === AST_NODE_TYPES.TemplateLiteral ||
      (value.type === AST_NODE_TYPES.Literal && typeof value.value === 'string')
    );
  };
  return (
    (readsVariable(inner.left, variable, sourceCode) && literalOk(inner.right)) ||
    (readsVariable(inner.right, variable, sourceCode) && literalOk(inner.left))
  );
}

/** A positive check on `variable`: true only when the value passed it. */
function isCheck(
  node: TSESTree.Node,
  variable: Subject,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
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
  return (
    indexOfCheck(inner, variable, true, sourceCode) ||
    isLiteralComparison(inner, variable, false, sourceCode)
  );
}

/**
 * `LIST.indexOf(x)` compared so the test holds only when `x` is in the list
 * (`positive`: `!== -1`, `>= 0`, `> -1`) or only when it is not (`=== -1`,
 * `< 0`), with the list one {@link isLiteralList} accepts.
 */
function indexOfCheck(
  node: TSESTree.Node,
  subject: Subject,
  positive: boolean,
  sourceCode: SourceCode,
): boolean {
  const inner = unwrap(node);
  if (inner.type !== AST_NODE_TYPES.BinaryExpression) {
    return false;
  }
  const call = memberCall(inner.left, 'indexOf');
  const bound = unwrap(inner.right);
  if (
    call === null ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    !readsVariable(call.arguments[0] as TSESTree.Node, subject, sourceCode) ||
    !isLiteralList(call.callee.object, sourceCode)
  ) {
    return false;
  }
  const value =
    bound.type === AST_NODE_TYPES.Literal && typeof bound.value === 'number'
      ? bound.value
      : bound.type === AST_NODE_TYPES.UnaryExpression &&
          bound.operator === '-' &&
          bound.argument.type === AST_NODE_TYPES.Literal &&
          bound.argument.value === 1
        ? -1
        : null;
  if (value === null) {
    return false;
  }
  const op = inner.operator;
  if (positive) {
    return (
      ((op === '!==' || op === '!=') && value === -1) ||
      (op === '>=' && value === 0) ||
      (op === '>' && value === -1)
    );
  }
  return ((op === '===' || op === '==') && value === -1) || (op === '<' && value === 0);
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
  variable: Subject,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  return flattenLogical(node, '||').some((term) => {
    if (term.type === AST_NODE_TYPES.UnaryExpression && term.operator === '!') {
      return isCheck(term.argument, variable, judge, sourceCode);
    }
    if (indexOfCheck(term, variable, false, sourceCode)) {
      return true;
    }
    const conjuncts = flattenLogical(term, '&&');
    return conjuncts.every((conjunct) => isLiteralComparison(conjunct, variable, true, sourceCode));
  });
}

/** A test that is true only when the check passed: `check`, `a === 'x' || a === 'y'`, `check && other`. */
function holdsOnlyIfChecked(
  node: TSESTree.Node,
  variable: Subject,
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

/** The nearest function around `node`, or null at the top level. */
function enclosingFunction(node: TSESTree.Node): TSESTree.Node | null {
  for (let current = node.parent; current != null; current = current.parent) {
    if (
      current.type === AST_NODE_TYPES.FunctionDeclaration ||
      current.type === AST_NODE_TYPES.FunctionExpression ||
      current.type === AST_NODE_TYPES.ArrowFunctionExpression
    ) {
      return current;
    }
  }
  return null;
}

/**
 * A guard test read through `!` and through a `const` boolean declared in the
 * same function (`const ok = A && B; if (!ok) return`): the test it stands for,
 * whether it is negated, and where the check really ran. Null when the test is
 * already plain.
 */
function expandTest(
  test: TSESTree.Expression,
  negated: boolean,
  at: TSESTree.Node,
  sourceCode: SourceCode,
): { test: TSESTree.Expression; negated: boolean; position: number } | null {
  let current = unwrap(test) as TSESTree.Expression;
  let flipped = negated;
  let position = at.range[0];
  let changed = false;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (current.type === AST_NODE_TYPES.UnaryExpression && current.operator === '!') {
      current = unwrap(current.argument) as TSESTree.Expression;
      flipped = !flipped;
      changed = true;
      continue;
    }
    if (current.type !== AST_NODE_TYPES.Identifier) {
      break;
    }
    const variable = variableOf(current, sourceCode);
    const init = variable === null ? null : constInit(variable);
    if (
      variable === null ||
      init === null ||
      isImportBinding(variable) ||
      enclosingFunction(init) !== enclosingFunction(at) ||
      init.range[0] > at.range[0]
    ) {
      break;
    }
    current = unwrap(init) as TSESTree.Expression;
    position = Math.min(position, init.range[0]);
    changed = true;
  }
  return changed ? { test: current, negated: flipped, position } : null;
}

/**
 * True when a guard runs before `sink` on every path to it: an `if` that
 * exits, before the sink in an enclosing block, whose test is true when the
 * value failed (`negated`); an `if` around the sink whose test passed; or a
 * `test ? sink : other` (or `test ? other : sink`) around it. Only blocks of
 * the function that holds the sink are searched. With `sourceCode`, a test is
 * also read through `!` and a `const` boolean (`const ok = re.test(x)`).
 * `writesEndBefore(position, scope)` says whether the checked bindings are no
 * longer written after a guard at `position`, for a guard and sink that run
 * in the function scope `scope`.
 */
function guardedBefore(
  sink: TSESTree.Node,
  isGuard: GuardTest,
  writesEndBefore: (position: number, scope: Scope | null) => boolean,
  sourceCode?: SourceCode,
): boolean {
  // The function scope the guard and the sink share (see `writtenOnlyBefore`).
  const scope = sourceCode === undefined ? null : sourceCode.getScope(sink).variableScope;
  const passes = (test: TSESTree.Expression, negated: boolean, at: TSESTree.Node): boolean => {
    if (writesEndBefore(at.range[0], scope) && isGuard(test, negated)) {
      return true;
    }
    const expanded = sourceCode === undefined ? null : expandTest(test, negated, at, sourceCode);
    return (
      expanded !== null &&
      writesEndBefore(expanded.position, scope) &&
      isGuard(expanded.test, expanded.negated)
    );
  };
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
          passes(statement.test, true, statement)
        ) {
          return true;
        }
      }
    }
    if (
      parent.type === AST_NODE_TYPES.IfStatement ||
      parent.type === AST_NODE_TYPES.ConditionalExpression
    ) {
      if (child === parent.consequent && passes(parent.test, false, parent)) {
        return true;
      }
      if (child === parent.alternate && passes(parent.test, true, parent)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True for an imported binding. An `import { cur }` is a live view of a
 * binding the other module can reassign at any time, so a check on it says
 * nothing about the value read later.
 */
function isImportBinding(variable: Variable): boolean {
  return variable.defs.some((def) => def.type === 'ImportBinding');
}

/** True when `variable` holds a value checked against `judge` before `sink`. */
function variableGuarded(
  variable: Variable,
  readAt: number,
  sink: TSESTree.Node,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  if (isImportBinding(variable)) {
    return false;
  }
  return guardedBefore(
    sink,
    (test, negated) =>
      negated
        ? failsUnlessChecked(test, variable, judge, sourceCode)
        : holdsOnlyIfChecked(test, variable, judge, sourceCode),
    // The value read at `readAt` is the checked one only if nothing wrote it
    // after the check or after the read (`const copy = x; x = y; check(x)`).
    (position, scope) => writtenOnlyBefore(variable, Math.min(position, readAt), scope),
    sourceCode,
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
  let current = unwrap(node);
  let confined = false;
  for (let depth = 0; depth < 32; depth += 1) {
    if (current.type === AST_NODE_TYPES.Identifier) {
      if (isSchemaModule(current, sourceCode)) {
        return confined;
      }
      // A `const` holding a chain is read on, under the same allowlist.
      const variable = variableOf(current, sourceCode);
      const init = variable === null ? null : constInit(variable);
      if (init === null) {
        return false;
      }
      current = unwrap(init);
      continue;
    }
    if (current.type !== AST_NODE_TYPES.CallExpression) {
      return false;
    }
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
            arg.type !== AST_NODE_TYPES.SpreadElement &&
            (isStaticLiteral(arg) || isLiteralList(arg, sourceCode)),
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
  return false;
}

const SCHEMA_MODULES: ReadonlySet<string> = new Set([
  'zod',
  'zod/v3',
  'zod/v4',
  'joi',
  '@hapi/joi',
]);

/** The name a schema module's root is imported under (`import { z } from 'zod'`). */
const SCHEMA_ROOT_EXPORTS: ReadonlySet<string> = new Set(['z', 'default']);

/**
 * True when `node` names the root of a zod or joi import: `import { z } from
 * 'zod'`, `import * as z from 'zod'`, `import Joi from 'joi'`,
 * `const Joi = require('joi')` or `const { z } = require('zod')`. A parameter
 * or any other binding could be an object with `pattern` methods of its own.
 */
function isSchemaModule(node: TSESTree.Identifier, sourceCode: SourceCode): boolean {
  const variable = variableOf(node, sourceCode);
  const def = variable?.defs[0];
  if (variable === null || variable.defs.length !== 1 || def === undefined) {
    return false;
  }
  if (def.type === 'ImportBinding') {
    const specifier = def.node;
    return (
      def.parent.type === AST_NODE_TYPES.ImportDeclaration &&
      SCHEMA_MODULES.has(def.parent.source.value) &&
      (specifier.type !== AST_NODE_TYPES.ImportSpecifier ||
        (specifier.imported.type === AST_NODE_TYPES.Identifier
          ? SCHEMA_ROOT_EXPORTS.has(specifier.imported.name)
          : SCHEMA_ROOT_EXPORTS.has(String(specifier.imported.value))))
    );
  }
  if (def.type !== 'Variable' || def.parent.kind !== 'const' || def.node.init === null) {
    return false;
  }
  const init = unwrap(def.node.init);
  const required =
    init.type === AST_NODE_TYPES.CallExpression &&
    isGlobal(init.callee, 'require', sourceCode) &&
    init.arguments.length === 1 &&
    init.arguments[0]?.type === AST_NODE_TYPES.Literal &&
    typeof init.arguments[0].value === 'string' &&
    SCHEMA_MODULES.has(init.arguments[0].value);
  if (!required) {
    return false;
  }
  const id = def.node.id;
  return (
    id.type === AST_NODE_TYPES.Identifier ||
    (id.type === AST_NODE_TYPES.ObjectPattern && destructuresRoot(id, variable.name))
  );
}

/** True when `{ z }` (or `{ z: name }`) binds `name` to the module's `z` export. */
function destructuresRoot(pattern: TSESTree.ObjectPattern, name: string): boolean {
  return pattern.properties.some(
    (property) =>
      property.type === AST_NODE_TYPES.Property &&
      !property.computed &&
      property.key.type === AST_NODE_TYPES.Identifier &&
      SCHEMA_ROOT_EXPORTS.has(property.key.name) &&
      property.value.type === AST_NODE_TYPES.Identifier &&
      property.value.name === name,
  );
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

/** `result.success` (or `!result.success` when `negated`) on the given binding. */
function isSuccessTest(
  test: TSESTree.Node,
  result: Variable,
  negated: boolean,
  sourceCode: SourceCode,
): boolean {
  let inner = unwrap(test);
  if (negated) {
    if (inner.type !== AST_NODE_TYPES.UnaryExpression || inner.operator !== '!') {
      return false;
    }
    inner = unwrap(inner.argument);
  }
  return (
    inner.type === AST_NODE_TYPES.MemberExpression &&
    !inner.computed &&
    inner.property.type === AST_NODE_TYPES.Identifier &&
    inner.property.name === 'success' &&
    inner.object.type === AST_NODE_TYPES.Identifier &&
    variableOf(inner.object, sourceCode) === result
  );
}

/**
 * `result.data` where `const result = schema.safeParse(x)` with a confined
 * schema, and `if (!result.success)` exits before the sink (or
 * `if (result.success)` is around it).
 */
function isConfinedSafeParseData(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.computed ||
    node.property.type !== AST_NODE_TYPES.Identifier ||
    node.property.name !== 'data' ||
    node.object.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  const result = variableOf(node.object, sourceCode);
  const init = result === null ? null : constInit(result);
  const call = init === null ? null : memberCall(init, 'safeParse');
  if (
    result === null ||
    call === null ||
    call.callee.type !== AST_NODE_TYPES.MemberExpression ||
    !schemaConfines(call.callee.object, judge, sourceCode)
  ) {
    return false;
  }
  return guardedBefore(
    sink,
    (test, negated) => isSuccessTest(test, result, negated, sourceCode),
    // Any change to `result` or `result.data`, before or after the check,
    // cancels it: `result.data = other` replaces the checked text.
    (position, scope) => writtenOnlyBefore(result, position, scope) && isUnchangedResultData(result, true),
    sourceCode,
  );
}

/**
 * The schema of `field` in an object schema chain (`z.object({ theme: ... })`,
 * `joi.object({ theme: ... })`), when every method after `object(...)` only
 * narrows; else null.
 */
function objectFieldSchema(
  node: TSESTree.Node,
  field: string,
  sourceCode: SourceCode,
): TSESTree.Node | null {
  let current = resolveConst(node, sourceCode);
  for (let depth = 0; depth < 16 && current.type === AST_NODE_TYPES.CallExpression; depth += 1) {
    const callee = current.callee;
    if (
      callee.type !== AST_NODE_TYPES.MemberExpression ||
      callee.computed ||
      callee.property.type !== AST_NODE_TYPES.Identifier
    ) {
      return null;
    }
    if (
      callee.property.name === 'object' &&
      callee.object.type === AST_NODE_TYPES.Identifier &&
      isSchemaModule(callee.object, sourceCode)
    ) {
      const shape = current.arguments[0] === undefined ? null : unwrap(current.arguments[0]);
      return shape?.type === AST_NODE_TYPES.ObjectExpression ? shapeField(shape, field) : null;
    }
    if (!SCHEMA_NARROWING_METHODS.has(callee.property.name)) {
      return null;
    }
    current = unwrap(callee.object);
  }
  return null;
}

/**
 * The value schema of `field` in an object shape, or null when the field is
 * missing or something after it could replace it: a spread (`...base`), a
 * computed key or a later key of the same name.
 */
function shapeField(shape: TSESTree.ObjectExpression, field: string): TSESTree.Node | null {
  let found: TSESTree.Node | null = null;
  for (const property of shape.properties) {
    if (property.type !== AST_NODE_TYPES.Property || property.computed) {
      if (found !== null) {
        return null;
      }
      continue;
    }
    const key =
      property.key.type === AST_NODE_TYPES.Identifier
        ? property.key.name
        : property.key.type === AST_NODE_TYPES.Literal
          ? String(property.key.value)
          : null;
    if (key === field) {
      if (found !== null) {
        return null;
      }
      found = property.value;
    }
  }
  return found;
}

/**
 * True when `id` (a reference to an object) is the object of a member read
 * that does not change it: not assigned, updated, deleted, destructured into,
 * looped into or called as a method. `parsed.mode = x`, `parsed['mode'] = x`
 * and `delete parsed.mode` are changes.
 */
function isReadOnlyMember(id: TSESTree.Node): boolean {
  const member = id.parent;
  if (member?.type !== AST_NODE_TYPES.MemberExpression || member.object !== id) {
    return false;
  }
  let outer: TSESTree.Node = member;
  while (
    outer.parent !== undefined &&
    (outer.parent.type === AST_NODE_TYPES.ChainExpression ||
      outer.parent.type === AST_NODE_TYPES.TSNonNullExpression ||
      outer.parent.type === AST_NODE_TYPES.TSAsExpression ||
      outer.parent.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      outer.parent.type === AST_NODE_TYPES.TSTypeAssertion)
  ) {
    outer = outer.parent;
  }
  const use = outer.parent;
  if (use === undefined) {
    return true;
  }
  switch (use.type) {
    case AST_NODE_TYPES.AssignmentExpression:
    case AST_NODE_TYPES.AssignmentPattern:
    case AST_NODE_TYPES.ForInStatement:
    case AST_NODE_TYPES.ForOfStatement:
      return use.left !== outer;
    case AST_NODE_TYPES.UpdateExpression:
    case AST_NODE_TYPES.ArrayPattern:
    case AST_NODE_TYPES.RestElement:
      return false;
    case AST_NODE_TYPES.UnaryExpression:
      return use.operator !== 'delete';
    case AST_NODE_TYPES.CallExpression:
      return use.callee !== outer;
    case AST_NODE_TYPES.Property:
      return use.parent.type !== AST_NODE_TYPES.ObjectPattern || use.value !== outer;
    default:
      return true;
  }
}

/**
 * True when nothing changes the object a parse returned: every use of the
 * binding is a read of one of its fields (`parsed.mode`). Any other use
 * (`Object.assign(parsed, x)`, `mutate(parsed)`, an alias) could change a field.
 */
function isUnchangedObject(variable: Variable): boolean {
  return variable.references.every(
    (reference) => reference.init === true || isReadOnlyMember(reference.identifier),
  );
}

/**
 * True when nothing changes the `data` object of a `safeParse` result: every
 * use of the binding reads another property (`result.success`,
 * `result.error`), or reads a field of `result.data` without changing it
 * (`result.data.mode = x` is a change). With `scalar`, `result.data` is a
 * string and may be read on its own; it still must not be written.
 * `Object.assign(result, x)`, `mutate(result)`, an alias and a destructuring
 * target (`({ v: result.data } = x)`) are all changes.
 */
function isUnchangedResultData(result: Variable, scalar = false): boolean {
  return result.references.every((reference) => {
    if (reference.init === true) {
      return true;
    }
    const id = reference.identifier;
    const member = id.parent;
    if (
      member?.type !== AST_NODE_TYPES.MemberExpression ||
      member.object !== id ||
      member.computed ||
      member.property.type !== AST_NODE_TYPES.Identifier ||
      !isReadOnlyMember(id)
    ) {
      return false;
    }
    // `result.error` and `result.success` are other objects; only `data` must stay unchanged.
    return member.property.name !== 'data' || scalar || isReadOnlyMember(member);
  });
}

/** The schema of a `schema.parse(x)` call, a `const` bound to one, else null. */
function parsedSchemaOf(node: TSESTree.Node, sourceCode: SourceCode): TSESTree.Node | null {
  const call = memberCall(resolveConst(node, sourceCode), 'parse');
  return call !== null && call.callee.type === AST_NODE_TYPES.MemberExpression
    ? call.callee.object
    : null;
}

/** `schema.parse(x).theme` or `parsed.theme`, where the object schema confines `theme`. */
function isConfinedParsedField(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.computed ||
    node.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  const field = node.property.name;
  const object = unwrap(node.object);
  let schema = parsedSchemaOf(object, sourceCode);
  if (schema !== null && object.type === AST_NODE_TYPES.Identifier) {
    // `const parsed = Body.parse(x); parsed.mode = other` changes the field.
    const parsed = variableOf(object, sourceCode);
    if (parsed === null || !isUnchangedObject(parsed)) {
      return false;
    }
  }
  if (schema === null && isConfinedSafeParseResult(object, sink, sourceCode)) {
    const data = object as TSESTree.MemberExpression;
    const result = variableOf(data.object as TSESTree.Identifier, sourceCode);
    if (result === null || !isUnchangedResultData(result)) {
      return false;
    }
    const call = memberCall(resolveConst(data.object, sourceCode), 'safeParse');
    schema =
      call !== null && call.callee.type === AST_NODE_TYPES.MemberExpression
        ? call.callee.object
        : null;
  }
  const fieldSchema = schema === null ? null : objectFieldSchema(schema, field, sourceCode);
  return fieldSchema !== null && schemaConfines(fieldSchema, judge, sourceCode);
}

/** `result.data` of a `safeParse` result whose failure exits before the sink. */
function isConfinedSafeParseResult(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  const inner = unwrap(node);
  if (
    inner.type !== AST_NODE_TYPES.MemberExpression ||
    inner.computed ||
    inner.property.type !== AST_NODE_TYPES.Identifier ||
    inner.property.name !== 'data' ||
    inner.object.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  const result = variableOf(inner.object, sourceCode);
  if (result === null || memberCall(resolveConst(inner.object, sourceCode), 'safeParse') === null) {
    return false;
  }
  return guardedBefore(
    sink,
    (test, negated) => isSuccessTest(test, result, negated, sourceCode),
    (position, scope) => writtenOnlyBefore(result, position, scope),
    sourceCode,
  );
}

/** `const { theme } = schema.parse(x)` where the object schema confines `theme`. */
function isConfinedDestructuredField(
  variable: Variable,
  judge: RegexJudge,
  sourceCode: SourceCode,
): boolean {
  const def = variable.defs[0];
  if (
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'const' ||
    def.node.id.type !== AST_NODE_TYPES.ObjectPattern ||
    def.node.init === null
  ) {
    return false;
  }
  const schema = parsedSchemaOf(def.node.init, sourceCode);
  if (schema === null) {
    return false;
  }
  for (const property of def.node.id.properties) {
    if (
      property.type === AST_NODE_TYPES.Property &&
      !property.computed &&
      property.key.type === AST_NODE_TYPES.Identifier &&
      property.value.type === AST_NODE_TYPES.Identifier &&
      property.value.name === variable.name
    ) {
      const fieldSchema = objectFieldSchema(schema, property.key.name, sourceCode);
      return fieldSchema !== null && schemaConfines(fieldSchema, judge, sourceCode);
    }
  }
  return false;
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
    sourceCode,
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
  if (
    isConfinedParse(node, judge, sourceCode) ||
    isConfinedSafeParseData(node, sink, judge, sourceCode) ||
    isConfinedParsedField(node, sink, judge, sourceCode)
  ) {
    return true;
  }
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(node, sourceCode);
  if (variable === null) {
    return false;
  }
  if (isConfinedDestructuredField(variable, judge, sourceCode)) {
    return true;
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
function isProcessEnvRead(node: TSESTree.Node, sourceCode: SourceCode): boolean {
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    (!node.computed || isStringLiteral(node.property)) &&
    node.object.type === AST_NODE_TYPES.MemberExpression &&
    !node.object.computed &&
    isGlobal(node.object.object, 'process', sourceCode) &&
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
  const node = peelStringWrappers(raw, sourceCode);
  const next = (child: TSESTree.Node): boolean =>
    isStaticLiteral(child) || isEnvironmentValue(child, sourceCode, depth + 1);
  if (isProcessEnvRead(node, sourceCode)) {
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
        node.arguments.every(
          (arg) => arg.type !== AST_NODE_TYPES.SpreadElement && isPlainLiteral(arg),
        ) &&
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
function hostBindingsOf(
  variable: Variable,
  sourceCode: SourceCode,
): { binding: Variable; readEnd: number }[] {
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
      return (
        written === field || (written !== null && written !== undefined && isStaticLiteral(written))
      );
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
export function isHostPinned(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  return hostPinned(node, sink, sourceCode, 0);
}

function hostPinned(
  raw: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const field = hostFieldSubject(peelStringWrappers(raw));
  const node = peelStringWrappers(field ?? urlObjectOf(raw));
  if (node.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(node, sourceCode);
  if (variable === null || isImportBinding(variable)) {
    return false;
  }
  if (urlObjectPinned(variable, sink, sourceCode)) {
    return true;
  }
  // `ALLOWED.includes(new URL(url).hostname)` checks the host without a binding.
  const inlineHost: Subject = (candidate) => {
    const subject = hostFieldSubject(peelStringWrappers(candidate, sourceCode));
    return subject !== null && subjectVariable(subject, sourceCode) === variable;
  };
  const inlineGuarded = guardedBefore(
    sink,
    (test, negated) =>
      negated
        ? failsUnlessChecked(test, inlineHost, regexPinsHost, sourceCode)
        : holdsOnlyIfChecked(test, inlineHost, regexPinsHost, sourceCode),
    (position, scope) => writtenOnlyBefore(variable, position, scope),
    sourceCode,
  );
  if (inlineGuarded) {
    return true;
  }
  for (const { binding, readEnd } of hostBindingsOf(variable, sourceCode)) {
    const guarded = guardedBefore(
      sink,
      (test, negated) =>
        negated
          ? failsUnlessChecked(test, binding, regexPinsHost, sourceCode)
          : holdsOnlyIfChecked(test, binding, regexPinsHost, sourceCode),
      (position, scope) =>
        writtenOnlyBefore(binding, position, scope) &&
        writtenOnlyBefore(variable, Math.min(position, readEnd), scope),
      sourceCode,
    );
    if (guarded) {
      return true;
    }
  }
  const init = constInit(variable);
  return init !== null && hostPinned(init, sink, sourceCode, depth + 1);
}

// ---------------------------------------------------------------------------
// Same-site paths and literal tables (redirect targets)
// ---------------------------------------------------------------------------

/**
 * Characters that, right after the leading `/`, would make a path
 * protocol-relative: `/` and `\` (read as `/`), and the tab and line breaks,
 * which the WHATWG URL parser drops from anywhere in the input, so a browser
 * sends `/<tab>/evil.com` to `evil.com`.
 */
const AUTHORITY_OPENERS = '/\\\t\n\r';

function admitsAuthorityOpener(chars: string): boolean {
  return [...AUTHORITY_OPENERS].some((char) => chars.includes(char));
}

/**
 * True when every string the regex accepts starts with one `/` followed by a
 * character that is not `/`, `\`, a tab or a line break, so a redirect to it
 * stays on the site (browsers read `/\host` and `/<tab>/host` as `//host`).
 * Read: `^/` or `^\/`, then a class or escape that admits none of those
 * characters (and is not made optional), or a negated class that excludes all
 * of them. What follows does not matter; a `|` anywhere, or the `m` flag,
 * rejects the pattern.
 */
export function regexPinsLocalPath(pattern: string, flags: string): boolean {
  if (flags.includes('m') || flags.includes('v')) {
    return false;
  }
  const head = /^\^\\?\//u.exec(pattern);
  if (head === null) {
    return false;
  }
  const rest = pattern.slice(head[0].length);
  const lookahead = /^\(\?!((?:\[[^\]]*\])|(?:\\.(?:\|\\.)*))\)/u.exec(rest);
  if (lookahead !== null) {
    return lookaheadPinsLocalPath(lookahead[1] ?? '', rest.slice(lookahead[0].length));
  }
  if (rest.includes('|')) {
    return false;
  }
  if (rest.startsWith('[^')) {
    const end = classEnd(rest, 0);
    if (end === -1) {
      return false;
    }
    const excluded = classCharacters(rest.slice(2, end));
    // `?`, `*`, `{0}`, `{00}` or `{0,n}` after the class would make it optional.
    return (
      excluded !== null &&
      [...AUTHORITY_OPENERS].every((char) => excluded.includes(char)) &&
      !/^(?:[?*]|\{0+(?:,\d*)?\})/u.test(rest.slice(end + 1))
    );
  }
  // The tokens say where the first character ends, whatever escape spells it
  // (`\x61` is one character written in four), and whether a quantifier makes
  // it optional.
  const tokens = tokenize(rest);
  const first = tokens?.[0];
  const next = tokens?.[1];
  return (
    first?.kind === 'chars' &&
    !admitsAuthorityOpener(first.chars ?? '') &&
    !(next?.kind === 'quantifier' && next.optional === true)
  );
}

/**
 * For `^\/(?!L)R`: true when every character an opener (`/`, `\`, a tab or a
 * line break) could be is refused by the lookahead `L` (a class or `\/|\\`)
 * or cannot be the first character of `R`. `R` must be plain character tokens
 * up to the closing `$`.
 */
function lookaheadPinsLocalPath(refusedSource: string, rest: string): boolean {
  let refused: string | null;
  if (refusedSource.startsWith('[')) {
    refused = refusedSource.startsWith('[^') ? null : classCharacters(refusedSource.slice(1, -1));
  } else {
    const escapes = refusedSource.split('|').map((part) => escapeCharacters(part.charAt(1)));
    refused = escapes.every((chars) => chars?.length === 1) ? escapes.join('') : null;
  }
  const tokens = tokenize(rest);
  const last = tokens?.at(-1);
  if (refused === null || tokens === null || last?.kind !== 'anchor' || last.chars !== '$') {
    return false;
  }
  const body = tokens.slice(0, -1);
  if (body.some((token) => token.kind !== 'chars' && token.kind !== 'quantifier')) {
    return false;
  }
  const first = firstCharacters(body);
  return (
    first !== null &&
    [...AUTHORITY_OPENERS].every((char) => refused.includes(char) || !first.includes(char))
  );
}

/** `x.startsWith('lit')` on the subject, or `x.includes('lit')` when `method` says so. */
function stringCall(
  node: TSESTree.Node,
  subject: Subject,
  method: string,
  literal: string,
  sourceCode: SourceCode,
): boolean {
  const call = memberCall(node, method);
  if (call === null || call.callee.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const argument = unwrap(call.arguments[0] as TSESTree.Node);
  return (
    readsVariable(call.callee.object, subject, sourceCode) &&
    argument.type === AST_NODE_TYPES.Literal &&
    argument.value === literal
  );
}

/**
 * True when `node` reads the subject binding itself, not through `String(x)`
 * or a template. A bare `x` may be an array (`?next[]=` in Express), where
 * `includes` compares whole elements, while `String(x)` is always a string.
 */
function readsBare(node: TSESTree.Node, subject: Subject, sourceCode: SourceCode): boolean {
  const inner = unwrap(node);
  return (
    typeof subject !== 'function' &&
    inner.type === AST_NODE_TYPES.Identifier &&
    variableOf(inner, sourceCode) === subject
  );
}

/** The receiver of `<receiver>.<method>(...)`, or null. */
function methodReceiver(node: TSESTree.Node, method: string): TSESTree.Node | null {
  const call = memberCall(node, method);
  return call !== null && call.callee.type === AST_NODE_TYPES.MemberExpression
    ? call.callee.object
    : null;
}

/**
 * What a positive term proves: `x.startsWith('/')` (`slashBare` when it reads
 * the bare `x`, which throws unless `x` is a string), or a local-path regex test.
 */
function localPathParts(
  term: TSESTree.Node,
  subject: Subject,
  sourceCode: SourceCode,
): { slash: boolean; slashBare: boolean; regex: boolean } {
  const inner = unwrap(term);
  const test = memberCall(inner, 'test');
  let regex = false;
  if (
    test !== null &&
    test.callee.type === AST_NODE_TYPES.MemberExpression &&
    readsVariable(test.arguments[0] as TSESTree.Node, subject, sourceCode)
  ) {
    const literal = regexOf(test.callee.object, sourceCode);
    regex = literal !== null && regexPinsLocalPath(literal.pattern, literal.flags);
  }
  const slash = stringCall(inner, subject, 'startsWith', '/', sourceCode);
  const receiver = methodReceiver(inner, 'startsWith');
  return {
    slash,
    slashBare: slash && receiver !== null && readsBare(receiver, subject, sourceCode),
    regex,
  };
}

/**
 * The characters a refused term rules out right after the leading `/`:
 * `x.startsWith('/<c>')`, `x.includes('<c>')`, or a test with an unanchored
 * one-class regex (`/[\s\\]/.test(x)`, no `g` or `y` flag, which would make the
 * test start past index 0), which matches any string holding one of its
 * characters. `bareIncludes` holds the characters refused only by `includes`
 * on the bare `x`, which counts only once `x` is known to be a string: on an
 * array, `['/\t/evil.com'].includes('\t')` is false. `startsWith` throws on an
 * array and a regex test reads `String(x)`, so those always count.
 */
function refusedOpeners(
  term: TSESTree.Node,
  subject: Subject,
  sourceCode: SourceCode,
): { chars: string; bareIncludes: string } {
  const inner = unwrap(term);
  let out = '';
  let bareIncludes = '';
  const includesReceiver = methodReceiver(inner, 'includes');
  const bare = includesReceiver !== null && readsBare(includesReceiver, subject, sourceCode);
  for (const char of AUTHORITY_OPENERS) {
    if (stringCall(inner, subject, 'startsWith', `/${char}`, sourceCode)) {
      out += char;
    } else if (stringCall(inner, subject, 'includes', char, sourceCode)) {
      if (bare) {
        bareIncludes += char;
      } else {
        out += char;
      }
    }
  }
  const test = memberCall(inner, 'test');
  if (
    test !== null &&
    test.callee.type === AST_NODE_TYPES.MemberExpression &&
    readsVariable(test.arguments[0] as TSESTree.Node, subject, sourceCode)
  ) {
    const literal = regexOf(test.callee.object, sourceCode);
    const tokens =
      literal === null || /[gyv]/u.test(literal.flags) ? null : tokenize(literal.pattern);
    const only = tokens?.length === 1 ? tokens[0] : undefined;
    if (only?.kind === 'chars') {
      out += only.chars ?? '';
    }
  }
  return { chars: out, bareIncludes };
}

/**
 * True when `test` is false whenever the subject is not a same-site path
 * (`negated`: the `if` exits when it is true), read as:
 *   !re.test(x)                                     with a local-path regex, or
 *   !x.startsWith('/') || x.startsWith('//') || x.startsWith('/\\')
 *     || x.includes('\t') || x.includes('\n') || x.includes('\r')
 * where each refused character after the `/` may be ruled out with
 * `startsWith('/<c>')`, `includes('<c>')` or a one-class regex
 * (`/[\s\\]/.test(x)`). The tab and line breaks count because browsers drop
 * them, so `/<tab>/evil.com` goes to `evil.com`. For an `if` around the sink,
 * the positive forms are joined with `&&`.
 */
function isLocalPathGuard(
  test: TSESTree.Node,
  negated: boolean,
  subject: Subject,
  sourceCode: SourceCode,
): boolean {
  const terms = flattenLogical(test, negated ? '||' : '&&');
  let slash = false;
  let slashBare = false;
  let refused = '';
  let bareIncludes = '';
  for (const term of terms) {
    const inner = unwrap(term);
    const positive = negated
      ? inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '!'
        ? inner.argument
        : null
      : inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '!'
        ? null
        : inner;
    const refusedTerm = negated
      ? inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '!'
        ? null
        : inner
      : inner.type === AST_NODE_TYPES.UnaryExpression && inner.operator === '!'
        ? inner.argument
        : null;
    if (positive !== null) {
      const parts = localPathParts(positive, subject, sourceCode);
      if (parts.regex) {
        return true;
      }
      slash ||= parts.slash;
      slashBare ||= parts.slashBare;
    }
    if (refusedTerm !== null) {
      const openers = refusedOpeners(refusedTerm, subject, sourceCode);
      refused += openers.chars;
      bareIncludes += openers.bareIncludes;
    }
  }
  // A bare `x.startsWith('/')` throws unless `x` is a string, which makes a
  // bare `x.includes(c)` a string search too.
  const all = slashBare ? refused + bareIncludes : refused;
  return slash && [...AUTHORITY_OPENERS].every((char) => all.includes(char));
}

/**
 * True when the URL `node`, used at `sink`, is a same-site path: a binding the
 * function checked before the sink with a local-path regex
 * ({@link regexPinsLocalPath}) or with `startsWith('/')` while refusing `//`,
 * `/\` and a tab or line break after the `/` (see {@link isLocalPathGuard}),
 * and not written after the check.
 */
export function isSameSitePath(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  const inner = peelStringWrappers(node, sourceCode);
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(inner, sourceCode);
  if (variable === null || isImportBinding(variable)) {
    return false;
  }
  if (
    guardedBefore(
      sink,
      (test, negated) => isLocalPathGuard(test, negated, variable, sourceCode),
      (position, scope) => writtenOnlyBefore(variable, Math.min(position, inner.range[0]), scope),
      sourceCode,
    )
  ) {
    return true;
  }
  const init = constInit(variable);
  return init !== null && init !== node && isSameSitePath(init, sink, sourceCode);
}

/** True when every use of a `const` table only reads it: `T[k]`, `T.k`, `T.get(k)`, `k in T`, `Object.hasOwn(T, k)`. */
function isReadOnlyTable(variable: Variable): boolean {
  const def = variable.defs[0];
  if (
    def?.type !== 'Variable' ||
    def.parent.parent.type === AST_NODE_TYPES.ExportNamedDeclaration
  ) {
    return false;
  }
  return variable.references.every((reference) => {
    if (reference.init === true) {
      return true;
    }
    const identifier = reference.identifier;
    const parent = identifier.parent;
    if (parent?.type === AST_NODE_TYPES.MemberExpression && parent.object === identifier) {
      const use = parent.parent;
      if (
        (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === parent) ||
        use.type === AST_NODE_TYPES.UpdateExpression ||
        (use.type === AST_NODE_TYPES.UnaryExpression && use.operator === 'delete')
      ) {
        return false;
      }
      if (use.type === AST_NODE_TYPES.CallExpression && use.callee === parent) {
        return (
          !parent.computed &&
          parent.property.type === AST_NODE_TYPES.Identifier &&
          ['get', 'has', 'hasOwnProperty'].includes(parent.property.name)
        );
      }
      return true;
    }
    if (
      parent?.type === AST_NODE_TYPES.BinaryExpression &&
      parent.operator === 'in' &&
      parent.right === identifier
    ) {
      return true;
    }
    return (
      parent?.type === AST_NODE_TYPES.CallExpression &&
      parent.arguments[0] === identifier &&
      parent.callee.type === AST_NODE_TYPES.MemberExpression &&
      !parent.callee.computed &&
      parent.callee.object.type === AST_NODE_TYPES.Identifier &&
      parent.callee.object.name === 'Object' &&
      parent.callee.property.type === AST_NODE_TYPES.Identifier &&
      parent.callee.property.name === 'hasOwn'
    );
  });
}

function literalValues(node: TSESTree.Node): boolean {
  const inner = unwrap(node);
  if (inner.type === AST_NODE_TYPES.ObjectExpression) {
    return (
      inner.properties.length > 0 &&
      inner.properties.every(
        (property) =>
          property.type === AST_NODE_TYPES.Property &&
          !property.computed &&
          property.kind === 'init' &&
          !property.method &&
          isStaticLiteral(property.value),
      )
    );
  }
  if (
    inner.type === AST_NODE_TYPES.NewExpression &&
    inner.callee.type === AST_NODE_TYPES.Identifier &&
    inner.callee.name === 'Map'
  ) {
    const [entries] = inner.arguments;
    return (
      entries?.type === AST_NODE_TYPES.ArrayExpression &&
      entries.elements.length > 0 &&
      entries.elements.every(
        (entry) =>
          entry?.type === AST_NODE_TYPES.ArrayExpression &&
          entry.elements.length === 2 &&
          entry.elements.every(
            (part) =>
              part !== null && part.type !== AST_NODE_TYPES.SpreadElement && isStaticLiteral(part),
          ),
      )
    );
  }
  return false;
}

/**
 * True when `node` is read from an in-file table of literals, so it can only
 * be one of the values the author wrote (or `undefined`): `TABLE[key]`,
 * `TABLE.key` or `MAP.get(key)` where the table is a `const` object or
 * `new Map([...])` of literal values that is never exported or changed. A
 * literal fallback (`TABLE[key] ?? '/'`) and `const` aliases are followed.
 */
export function isLiteralTableRead(
  node: TSESTree.Node,
  sourceCode: SourceCode,
  depth = 0,
): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const inner = peelStringWrappers(node, sourceCode);
  if (inner.type === AST_NODE_TYPES.LogicalExpression) {
    const side = (part: TSESTree.Node): boolean =>
      isStaticLiteral(part) || isLiteralTableRead(part, sourceCode, depth + 1);
    return side(inner.left) && side(inner.right);
  }
  if (inner.type === AST_NODE_TYPES.Identifier) {
    const variable = variableOf(inner, sourceCode);
    const init = variable === null ? null : constInit(variable);
    return init !== null && isLiteralTableRead(init, sourceCode, depth + 1);
  }
  let table: TSESTree.Node | null = null;
  if (inner.type === AST_NODE_TYPES.MemberExpression) {
    table = inner.object;
  } else {
    const get = memberCall(inner, 'get');
    if (get !== null && get.callee.type === AST_NODE_TYPES.MemberExpression) {
      table = get.callee.object;
    }
  }
  const tableNode = table === null ? null : unwrap(table);
  if (tableNode?.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(tableNode, sourceCode);
  const init = variable === null ? null : constInit(variable);
  if (variable === null || init === null || !literalValues(init) || !isReadOnlyTable(variable)) {
    return false;
  }
  // `TABLE.key` on an object, `MAP.get(k)` on a Map; a computed read on a Map is not a lookup.
  const isMap = unwrap(init).type === AST_NODE_TYPES.NewExpression;
  return isMap
    ? inner.type === AST_NODE_TYPES.CallExpression
    : inner.type === AST_NODE_TYPES.MemberExpression;
}

/** For `u.href` or `u.toString()`, the `u`; any other node as it is. */
function urlObjectOf(node: TSESTree.Node): TSESTree.Node {
  const inner = unwrap(node);
  if (
    inner.type === AST_NODE_TYPES.MemberExpression &&
    !inner.computed &&
    inner.property.type === AST_NODE_TYPES.Identifier &&
    inner.property.name === 'href'
  ) {
    return inner.object;
  }
  if (
    inner.type === AST_NODE_TYPES.CallExpression &&
    inner.arguments.length === 0 &&
    inner.callee.type === AST_NODE_TYPES.MemberExpression &&
    !inner.callee.computed &&
    inner.callee.property.type === AST_NODE_TYPES.Identifier &&
    inner.callee.property.name === 'toString'
  ) {
    return inner.callee.object;
  }
  return node;
}

/** True when a fresh global `new URL(...)` is all the binding is ever set to. */
function isNewUrl(node: TSESTree.Node | null | undefined, sourceCode: SourceCode): boolean {
  const created = node == null ? null : unwrap(node);
  return (
    created?.type === AST_NODE_TYPES.NewExpression && isGlobal(created.callee, 'URL', sourceCode)
  );
}

/**
 * True when every value the binding is given is a `new URL(...)`: a `const`, or
 * a `let` set only in plain assignments (`try { u = new URL(x, base) } catch {
 * u = new URL(FALLBACK) }`).
 */
function holdsOnlyUrls(variable: Variable, sourceCode: SourceCode): boolean {
  const init = constInit(variable);
  if (init !== null) {
    return isNewUrl(init, sourceCode);
  }
  const def = variable.defs[0];
  if (
    variable.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier
  ) {
    return false;
  }
  const writes = variable.references.filter((reference) => reference.isWrite());
  return (
    writes.length > 0 &&
    writes.every((reference) => {
      const parent = reference.identifier.parent;
      return (
        (reference.init === true ||
          (parent?.type === AST_NODE_TYPES.AssignmentExpression && parent.operator === '=')) &&
        isNewUrl(reference.writeExpr, sourceCode)
      );
    })
  );
}

/**
 * True when `variable` is a `const` holding `new URL(...)` whose `hostname`
 * (or `host` / `origin`) the function checked against an allowlist before the
 * sink, with no change to the URL object after the check (`u.host = x` is a
 * change): `const u = new URL(x); if (!HOSTS.has(u.hostname)) return; get(u)`.
 */
function urlObjectPinned(variable: Variable, sink: TSESTree.Node, sourceCode: SourceCode): boolean {
  if (!holdsOnlyUrls(variable, sourceCode)) {
    return false;
  }
  const hostOfUrl: Subject = (candidate) =>
    candidate.type === AST_NODE_TYPES.MemberExpression &&
    !candidate.computed &&
    candidate.property.type === AST_NODE_TYPES.Identifier &&
    HOST_FIELDS.has(candidate.property.name) &&
    subjectVariable(candidate.object, sourceCode) === variable;
  return guardedBefore(
    sink,
    (test, negated) =>
      negated
        ? failsUnlessChecked(test, hostOfUrl, regexPinsHost, sourceCode)
        : holdsOnlyIfChecked(test, hostOfUrl, regexPinsHost, sourceCode),
    (position, scope) => writtenOnlyBefore(variable, position, scope),
    sourceCode,
  );
}

// ---------------------------------------------------------------------------
// Redirect targets built from checked parts
// ---------------------------------------------------------------------------

/** A `scheme://host` origin with nothing after the host. */
const ORIGIN_ONLY = /^https?:\/\/[^/?#@\\\s]+$/iu;

/**
 * The pieces of a string built with `+` or a template, in order: static text
 * (from literals, quasis and `const` string literals) and the runtime values.
 * Empty text is dropped, so two adjacent values stay adjacent.
 */
function stringSegments(node: TSESTree.Node, sourceCode: SourceCode): (string | TSESTree.Node)[] {
  const out: (string | TSESTree.Node)[] = [];
  const push = (text: string): void => {
    if (text === '') {
      return;
    }
    const last = out.at(-1);
    if (typeof last === 'string') {
      out[out.length - 1] = last + text;
    } else {
      out.push(text);
    }
  };
  const collect = (part: TSESTree.Node): void => {
    const inner = unwrap(part);
    if (inner.type === AST_NODE_TYPES.TemplateLiteral) {
      inner.quasis.forEach((quasi, index) => {
        push(quasi.value.cooked ?? '');
        const expression = inner.expressions[index];
        if (expression !== undefined) {
          collect(expression);
        }
      });
    } else if (inner.type === AST_NODE_TYPES.BinaryExpression && inner.operator === '+') {
      collect(inner.left);
      collect(inner.right);
    } else {
      const resolved = resolveConst(inner, sourceCode);
      if (resolved.type === AST_NODE_TYPES.Literal && typeof resolved.value === 'string') {
        push(resolved.value);
      } else {
        out.push(inner);
      }
    }
  };
  collect(node);
  return out;
}

/**
 * True when `node` is a binding checked against a literal allowlist before
 * `sink` (`if (!ALLOWED.has(x)) return`), so it holds one of the values the
 * author wrote. Regex checks do not count here.
 */
function isAllowlisted(node: TSESTree.Node, sink: TSESTree.Node, sourceCode: SourceCode): boolean {
  const inner = peelStringWrappers(node, sourceCode);
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(inner, sourceCode);
  return (
    variable !== null && variableGuarded(variable, inner.range[0], sink, () => false, sourceCode)
  );
}

/**
 * True for a value checked against a literal allowlist, alone or followed by
 * text that starts a query or a fragment (`${target}?from=${page}`), which
 * cannot move the host the allowlisted value names.
 */
export function isAllowlistedTarget(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  const [first, second] = stringSegments(node, sourceCode);
  return (
    first !== undefined &&
    typeof first !== 'string' &&
    isAllowlisted(first, sink, sourceCode) &&
    (second === undefined || (typeof second === 'string' && /^[?#]/u.test(second)))
  );
}

/** True when the value is known to start with `/` at `sink`. */
function startsWithSlash(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
  depth: number,
): boolean {
  if (depth > MAX_DEPTH) {
    return false;
  }
  const inner = peelStringWrappers(node, sourceCode);
  if (inner.type === AST_NODE_TYPES.ConditionalExpression) {
    return (
      startsWithSlash(inner.consequent, inner.consequent, sourceCode, depth + 1) &&
      startsWithSlash(inner.alternate, inner.alternate, sourceCode, depth + 1)
    );
  }
  const first = stringSegments(inner, sourceCode)[0];
  if (typeof first === 'string') {
    return first.startsWith('/');
  }
  if (first !== inner && first !== undefined) {
    return startsWithSlash(first, sink, sourceCode, depth + 1);
  }
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return false;
  }
  const variable = variableOf(inner, sourceCode);
  if (variable === null || isImportBinding(variable)) {
    return false;
  }
  const slashTerm = (term: TSESTree.Node): boolean =>
    stringCall(term, variable, 'startsWith', '/', sourceCode) ||
    localPathParts(term, variable, sourceCode).regex;
  const guarded = guardedBefore(
    sink,
    (test, negated) =>
      negated
        ? flattenLogical(test, '||').some(
            (term) =>
              term.type === AST_NODE_TYPES.UnaryExpression &&
              term.operator === '!' &&
              slashTerm(term.argument),
          )
        : flattenLogical(test, '&&').some(slashTerm),
    (position, scope) => writtenOnlyBefore(variable, Math.min(position, inner.range[0]), scope),
    sourceCode,
  );
  if (guarded) {
    return true;
  }
  const init = constInit(variable);
  return init !== null && startsWithSlash(init, init, sourceCode, depth + 1);
}

/**
 * True for a literal origin with no path followed by a value that starts with
 * `/` (`'https://app.example.com' + (local ? next : '/')`): the host is fixed
 * by the literal, so `//` or `/\` after it only changes the path.
 */
export function isFixedOriginPath(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  const [first, second] = stringSegments(node, sourceCode);
  if (typeof first !== 'string' || second === undefined) {
    return false;
  }
  if (ORIGIN_ONLY.test(first)) {
    return typeof second === 'string'
      ? second.startsWith('/')
      : startsWithSlash(second, second, sourceCode, 0);
  }
  return false;
}

/** `u.<field>` for the given binding. */
function urlField(
  node: TSESTree.Node,
  url: Variable,
  field: string,
  sourceCode: SourceCode,
): boolean {
  const inner = unwrap(node);
  return (
    inner.type === AST_NODE_TYPES.MemberExpression &&
    !inner.computed &&
    inner.property.type === AST_NODE_TYPES.Identifier &&
    inner.property.name === field &&
    subjectVariable(inner.object, sourceCode) === url
  );
}

/** `u.origin === ORIGIN` (or `!==` when `negated`) against a literal origin. */
function originComparison(
  term: TSESTree.Node,
  url: Variable,
  negated: boolean,
  sourceCode: SourceCode,
): boolean {
  const inner = unwrap(term);
  if (
    inner.type !== AST_NODE_TYPES.BinaryExpression ||
    inner.operator !== (negated ? '!==' : '===')
  ) {
    return false;
  }
  const literalOrigin = (side: TSESTree.Node): boolean => {
    const resolved = resolveConst(side, sourceCode);
    return (
      resolved.type === AST_NODE_TYPES.Literal &&
      typeof resolved.value === 'string' &&
      ORIGIN_ONLY.test(resolved.value)
    );
  };
  return (
    (urlField(inner.left, url, 'origin', sourceCode) && literalOrigin(inner.right)) ||
    (urlField(inner.right, url, 'origin', sourceCode) && literalOrigin(inner.left))
  );
}

/** `u.pathname.startsWith('//')`. */
function doubleSlashPath(term: TSESTree.Node, url: Variable, sourceCode: SourceCode): boolean {
  const call = memberCall(unwrap(term), 'startsWith');
  const argument = call?.arguments[0];
  return (
    call !== null &&
    call.callee.type === AST_NODE_TYPES.MemberExpression &&
    urlField(call.callee.object, url, 'pathname', sourceCode) &&
    argument?.type === AST_NODE_TYPES.Literal &&
    argument.value === '//'
  );
}

/**
 * True for `u.pathname` (optionally followed by `u.search`, `u.hash` and
 * literal text) of a URL object whose origin was compared to a literal origin
 * and whose path was refused when it starts with `//`, before the sink and
 * with no change to the URL after: `const ok = u.origin === ORIGIN &&
 * !u.pathname.startsWith('//')`, then `ok ? u.pathname + u.search : '/'`.
 */
export function isSameOriginUrlPath(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  const segments = stringSegments(node, sourceCode);
  const first = segments[0];
  if (first === undefined || typeof first === 'string') {
    return false;
  }
  const field = unwrap(first);
  if (field.type !== AST_NODE_TYPES.MemberExpression) {
    return false;
  }
  const url = subjectVariable(field.object, sourceCode);
  if (
    url === null ||
    isImportBinding(url) ||
    !holdsOnlyUrls(url, sourceCode) ||
    !urlField(field, url, 'pathname', sourceCode) ||
    !segments
      .slice(1)
      .every(
        (segment) =>
          typeof segment === 'string' ||
          urlField(segment, url, 'search', sourceCode) ||
          urlField(segment, url, 'hash', sourceCode),
      )
  ) {
    return false;
  }
  return guardedBefore(
    sink,
    (test, negated) => {
      const terms = flattenLogical(test, negated ? '||' : '&&');
      const origin = terms.some((term) => originComparison(term, url, negated, sourceCode));
      const double = terms.some((term) => {
        const inner = unwrap(term);
        if (negated) {
          return doubleSlashPath(inner, url, sourceCode);
        }
        return (
          inner.type === AST_NODE_TYPES.UnaryExpression &&
          inner.operator === '!' &&
          doubleSlashPath(inner.argument, url, sourceCode)
        );
      });
      return origin && double;
    },
    (position, scope) => writtenOnlyBefore(url, position, scope),
    sourceCode,
  );
}

// ---------------------------------------------------------------------------
// Checked member expressions
// ---------------------------------------------------------------------------

/** `req.params.name` as its root binding and property names, or null for a computed or odd chain. */
function memberPath(node: TSESTree.Node): { root: TSESTree.Identifier; path: string[] } | null {
  const path: string[] = [];
  let current: TSESTree.Node = node;
  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    if (current.type === AST_NODE_TYPES.ChainExpression) {
      current = current.expression;
      continue;
    }
    current = unwrap(current);
    if (current.type === AST_NODE_TYPES.Identifier) {
      return path.length > 0 ? { root: current, path: path.reverse() } : null;
    }
    if (current.type !== AST_NODE_TYPES.MemberExpression) {
      return null;
    }
    if (!current.computed && current.property.type === AST_NODE_TYPES.Identifier) {
      path.push(current.property.name);
    } else if (
      current.computed &&
      current.property.type === AST_NODE_TYPES.Literal &&
      typeof current.property.value === 'string'
    ) {
      path.push(current.property.value);
    } else {
      return null;
    }
    current = current.object;
  }
  return null;
}

/** True when `node` is changed in place: assigned, updated, deleted or the target of `Object.assign`. */
function isWriteTarget(node: TSESTree.Node, sourceCode: SourceCode): boolean {
  let outer: TSESTree.Node = node;
  while (
    outer.parent !== undefined &&
    (outer.parent.type === AST_NODE_TYPES.ChainExpression ||
      outer.parent.type === AST_NODE_TYPES.TSNonNullExpression ||
      outer.parent.type === AST_NODE_TYPES.TSAsExpression)
  ) {
    outer = outer.parent;
  }
  const use = outer.parent;
  if (use === undefined) {
    return false;
  }
  if (use.type === AST_NODE_TYPES.AssignmentExpression && use.left === outer) {
    return true;
  }
  if (use.type === AST_NODE_TYPES.UpdateExpression) {
    return true;
  }
  if (use.type === AST_NODE_TYPES.UnaryExpression && use.operator === 'delete') {
    return true;
  }
  if (
    (use.type === AST_NODE_TYPES.ForInStatement || use.type === AST_NODE_TYPES.ForOfStatement) &&
    use.left === outer
  ) {
    return true;
  }
  return (
    use.type === AST_NODE_TYPES.CallExpression &&
    use.arguments[0] === outer &&
    use.callee.type === AST_NODE_TYPES.MemberExpression &&
    !use.callee.computed &&
    isGlobal(use.callee.object, 'Object', sourceCode) &&
    use.callee.property.type === AST_NODE_TYPES.Identifier &&
    (use.callee.property.name === 'assign' || use.callee.property.name === 'defineProperty')
  );
}

/**
 * True when the member expression `node` (`req.params.name`) was checked
 * against a literal allowlist before `sink` (`if (!NAMES.includes(req.params.name))
 * return`) and nothing writes that member, or any object on its path, anywhere
 * (`req.params.name = x`, `req.params = {}`, `Object.assign(req.params, x)`).
 * Regex checks do not count.
 */
export function isAllowlistedMember(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: SourceCode,
): boolean {
  const target = memberPath(node);
  const root = target === null ? null : variableOf(target.root, sourceCode);
  if (target === null || root === null || isImportBinding(root)) {
    return false;
  }
  const changed = root.references.some((reference) => {
    if (reference.isWrite() && reference.init !== true) {
      return true;
    }
    // Climb the chain from the root while it follows the target's path.
    let current: TSESTree.Node = reference.identifier;
    for (let index = 0; ; index += 1) {
      if (isWriteTarget(current, sourceCode)) {
        return true;
      }
      const parent: TSESTree.Node | undefined = current.parent;
      const step = parent === undefined ? null : memberPath(parent);
      if (
        index >= target.path.length ||
        parent?.type !== AST_NODE_TYPES.MemberExpression ||
        parent.object !== current ||
        step === null ||
        step.path[index] !== target.path[index]
      ) {
        return false;
      }
      current = parent;
    }
  });
  if (changed) {
    return false;
  }
  const sameMember: Subject = (candidate) => {
    const path = memberPath(candidate);
    return (
      path !== null &&
      variableOf(path.root, sourceCode) === root &&
      path.path.length === target.path.length &&
      path.path.every((name, index) => name === target.path[index])
    );
  };
  const noRegex: RegexJudge = () => false;
  return guardedBefore(
    sink,
    (test, negated) =>
      negated
        ? failsUnlessChecked(test, sameMember, noRegex, sourceCode)
        : holdsOnlyIfChecked(test, sameMember, noRegex, sourceCode),
    () => true,
    sourceCode,
  );
}
