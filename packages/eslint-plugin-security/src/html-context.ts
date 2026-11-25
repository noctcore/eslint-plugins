/*
 * Where a runtime value lands in HTML, read from the static text written
 * before it. A small tokenizer after the HTML parsing rules: it follows tags,
 * attributes and their quoting, comments, and the elements whose content is
 * not markup (`script`, `style`, `textarea`, `title` and the raw text
 * elements), which is all an escaper's safety depends on.
 *
 * Runtime parts are opaque: inside an attribute value they count as text, in a
 * tag or attribute name they make the name unknown (an unknown attribute may
 * be an event handler, an unknown element may be a `script`).
 */

/**
 * The places a value can land, each with its own escaping needs.
 *
 *  - `text`: element content, where `<` and `&` start markup.
 *  - `rcdata`: `textarea` / `title` content, raw text elements (`xmp`,
 *    `iframe`, `noscript`, ...) and comments: only a closing tag or `-->` ends
 *    them, which an escaped `<` or `>` cannot write.
 *  - `attr-dq`, `attr-sq`, `attr-unquoted`: an attribute value by its quoting.
 *  - `url-dq`, `url-sq`, `url-unquoted`: the start of a URL attribute value
 *    (`href`, `src`, ...) before the author text fixes a scheme, where
 *    `javascript:` survives HTML escaping.
 *  - `tag`: a tag name, an attribute name or the space between attributes.
 *  - `script`, `style`: the content of those elements; `script` is a code
 *    position, where a whole JS expression may stand.
 *  - `script-string`: inside a `'`, `"` or backtick string, or a comment, in
 *    a script element, where serialized JSON is not enough: its own quotes
 *    close a `"` string and it leaves `'` and backticks alone.
 *  - `code-attr`: an event handler (`on*`), `style` or `srcdoc` attribute,
 *    whose value is decoded and then run as script, CSS or HTML.
 */
export type HtmlContext =
  | 'text'
  | 'rcdata'
  | 'attr-dq'
  | 'attr-sq'
  | 'attr-unquoted'
  | 'url-dq'
  | 'url-sq'
  | 'url-unquoted'
  | 'tag'
  | 'script'
  | 'script-string'
  | 'style'
  | 'code-attr';

export const ALL_CONTEXTS: readonly HtmlContext[] = [
  'text',
  'rcdata',
  'attr-dq',
  'attr-sq',
  'attr-unquoted',
  'url-dq',
  'url-sq',
  'url-unquoted',
  'tag',
  'script',
  'script-string',
  'style',
  'code-attr',
];

/** How each context reads in a report. */
export const CONTEXT_LABELS: Readonly<Record<HtmlContext, string>> = {
  text: 'element text',
  rcdata: 'a textarea, title, raw text element or comment',
  'attr-dq': 'a double-quoted attribute',
  'attr-sq': 'a single-quoted attribute, which an escaper that leaves `\'` alone does not close',
  'attr-unquoted': 'an unquoted attribute, where a space starts a new attribute',
  'url-dq': 'the start of a URL attribute, where `javascript:` survives HTML escaping',
  'url-sq': 'the start of a URL attribute, where `javascript:` survives HTML escaping',
  'url-unquoted': 'the start of an unquoted URL attribute, where `javascript:` survives HTML escaping',
  tag: 'a tag or attribute name',
  script: 'a script element, where HTML escaping does not stop script',
  'script-string': 'a string, template or comment in a script element, which serialized JSON can close',
  style: 'a style element, where HTML escaping does not stop CSS injection',
  'code-attr': 'an event handler, style or srcdoc attribute, whose decoded value runs as code',
};

type Mode =
  | 'data'
  | 'tag-open'
  | 'bang'
  | 'bang-dash'
  | 'tag-name'
  | 'end-tag'
  | 'before-attr'
  | 'attr-name'
  | 'after-attr'
  | 'before-value'
  | 'value-dq'
  | 'value-sq'
  | 'value-unq'
  | 'comment'
  | 'declaration'
  | 'raw';

/** One tokenizer state. Plain data, so a state can be copied and compared. */
export interface HtmlState {
  readonly mode: Mode;
  /** The start tag being read, or the element whose raw content this is (`?` when unknown). */
  readonly tag: string;
  /** The attribute being read (`?` in it when partly runtime). */
  readonly attr: string;
  /** The attribute value so far, runtime parts as `a`; the recent text in comments and raw content. */
  readonly value: string;
  /** In script content, the open JS strings, templates and comments (see `jsStep`); empty in code position. */
  readonly js?: string;
}

export const START_STATE: HtmlState = { mode: 'data', tag: '', attr: '', value: '' };

/** Elements whose content is script or CSS. */
const CODE_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style']);
/** Elements whose content is text up to their closing tag. */
const TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
  'plaintext',
]);
/** Attributes whose value is a URL that can carry a `javascript:` scheme. */
const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'xlink:href',
  'data',
  'poster',
  'background',
  'cite',
  'codebase',
  'longdesc',
  'lowsrc',
  'dynsrc',
  'manifest',
  'icon',
  'ping',
  'srcset',
  'archive',
  'classid',
  'usemap',
  'profile',
  'itemtype',
]);
/** True for an attribute whose value is a URL (`href`, `src`, ...). */
export function isUrlAttribute(name: string): boolean {
  return URL_ATTRIBUTES.has(name.toLowerCase());
}

/** Attributes whose value runs as code once decoded: CSS and an inline document. */
const CODE_ATTRIBUTES: ReadonlySet<string> = new Set(['style', 'srcdoc']);
const SPACE = /[\t\n\f\r ]/u;
const LETTER = /[a-z]/iu;
/** Stands for a runtime part in a URL prefix: it may be any scheme letters. */
const RUNTIME = '\uE000';
/** A URL that may still be a scheme: empty, or letters and `+.-` (or runtime parts) with no `:` yet. */
const OPEN_SCHEME = /^(?:[a-z\uE000][a-z\d+.\-\uE000]*)?$/iu;
/** The scheme a URL prefix has closed. */
const CLOSED_SCHEME = /^([a-z\uE000][a-z\d+.\-\uE000]*):/iu;
/** Schemes whose URL body is script. */
const SCRIPT_SCHEMES = /^(?:javascript|vbscript)$/iu;

/**
 * Appends to an attribute value, keeping only what decides its context: the
 * normalized prefix of a URL attribute while it may still become a scheme,
 * then `#` for a fixed scheme or a path, or `!` when the scheme is script or
 * was built from a runtime part (`${p}:...`), whose body is then code.
 * Nothing is kept for other attributes.
 */
function appendValue(state: HtmlState, text: string): HtmlState {
  if (!URL_ATTRIBUTES.has(state.attr) || state.value === '#' || state.value === '!') {
    return state.value === '' || state.value === '#' || state.value === '!' ? state : { ...state, value: '' };
  }
  // Browsers drop leading spaces and controls and every tab or newline.
  const prefix = (state.value + text).replace(/^[\u0000-\u0020]+/u, '').replace(/[\t\n\r]/gu, '');
  if (OPEN_SCHEME.test(prefix)) {
    return { ...state, value: prefix };
  }
  const scheme = CLOSED_SCHEME.exec(prefix)?.[1];
  const code = scheme !== undefined && (scheme.includes(RUNTIME) || SCRIPT_SCHEMES.test(scheme));
  return { ...state, value: code ? '!' : '#' };
}

function closeStartTag(state: HtmlState): HtmlState {
  const tag = state.tag;
  if (tag.includes('?')) {
    return { mode: 'raw', tag: '?', attr: '', value: '' };
  }
  if (CODE_ELEMENTS.has(tag) || TEXT_ELEMENTS.has(tag)) {
    return { mode: 'raw', tag, attr: '', value: '' };
  }
  return START_STATE;
}

/** True when `buffer` ends with the opening of the end tag of `tag` (`</script`). */
function endsWithEndTagOpen(buffer: string, tag: string): boolean {
  if (tag === '?') {
    return /<\/$/u.test(buffer);
  }
  return buffer.toLowerCase().endsWith(`</${tag}`);
}

/** The state after one character of author text. */
function step(state: HtmlState, char: string): HtmlState {
  switch (state.mode) {
    case 'data':
      return char === '<' ? { ...state, mode: 'tag-open' } : state;
    case 'tag-open':
      if (LETTER.test(char)) {
        return { mode: 'tag-name', tag: char.toLowerCase(), attr: '', value: '' };
      }
      if (char === '/') {
        return { ...state, mode: 'end-tag' };
      }
      if (char === '!') {
        return { ...state, mode: 'bang' };
      }
      if (char === '?') {
        return { ...state, mode: 'declaration' };
      }
      return START_STATE;
    case 'bang':
      return char === '-' ? { ...state, mode: 'bang-dash' } : { ...state, mode: char === '>' ? 'data' : 'declaration' };
    case 'bang-dash':
      return char === '-'
        ? { mode: 'comment', tag: '', attr: '', value: '' }
        : { ...state, mode: char === '>' ? 'data' : 'declaration' };
    case 'tag-name':
      if (SPACE.test(char) || char === '/') {
        return { ...state, mode: 'before-attr' };
      }
      if (char === '>') {
        return closeStartTag(state);
      }
      return { ...state, tag: state.tag + char.toLowerCase() };
    case 'end-tag':
    case 'declaration':
      return char === '>' ? START_STATE : state;
    case 'before-attr':
      if (SPACE.test(char) || char === '/') {
        return state;
      }
      if (char === '>') {
        return closeStartTag(state);
      }
      return { ...state, mode: 'attr-name', attr: char.toLowerCase(), value: '' };
    case 'attr-name':
      if (SPACE.test(char)) {
        return { ...state, mode: 'after-attr' };
      }
      if (char === '/') {
        return { ...state, mode: 'before-attr' };
      }
      if (char === '=') {
        return { ...state, mode: 'before-value' };
      }
      if (char === '>') {
        return closeStartTag(state);
      }
      return { ...state, attr: state.attr + char.toLowerCase() };
    case 'after-attr':
      if (SPACE.test(char)) {
        return state;
      }
      if (char === '/') {
        return { ...state, mode: 'before-attr' };
      }
      if (char === '=') {
        return { ...state, mode: 'before-value' };
      }
      if (char === '>') {
        return closeStartTag(state);
      }
      return { ...state, mode: 'attr-name', attr: char.toLowerCase(), value: '' };
    case 'before-value':
      if (SPACE.test(char)) {
        return state;
      }
      if (char === '"') {
        return { ...state, mode: 'value-dq', value: '' };
      }
      if (char === "'") {
        return { ...state, mode: 'value-sq', value: '' };
      }
      if (char === '>') {
        return closeStartTag(state);
      }
      return appendValue({ ...state, mode: 'value-unq', value: '' }, char);
    case 'value-dq':
      return char === '"' ? { ...state, mode: 'before-attr', value: '' } : appendValue(state, char);
    case 'value-sq':
      return char === "'" ? { ...state, mode: 'before-attr', value: '' } : appendValue(state, char);
    case 'value-unq':
      if (SPACE.test(char)) {
        return { ...state, mode: 'before-attr', value: '' };
      }
      if (char === '>') {
        return closeStartTag(state);
      }
      return appendValue(state, char);
    case 'comment': {
      const recent = (state.value + char).slice(-3);
      return recent === '-->' ? START_STATE : { ...state, value: recent };
    }
    case 'raw': {
      // `value` keeps the recent text; a pending end tag waits for its delimiter.
      // `</script>` ends the element even inside a JS string, so the lexer only
      // runs alongside the end tag check.
      const js = state.tag === 'script' || state.tag === '?' ? jsStep(state.js ?? '', char) : undefined;
      if (state.attr === 'end') {
        if (SPACE.test(char) || char === '/') {
          return { mode: 'end-tag', tag: '', attr: '', value: '' };
        }
        if (char === '>') {
          return START_STATE;
        }
        if (state.tag === '?') {
          return { mode: 'end-tag', tag: '', attr: '', value: '' };
        }
        return { ...state, attr: '', value: (state.value + char).slice(-16), js };
      }
      const recent = (state.value + char).slice(-16);
      if (endsWithEndTagOpen(recent, state.tag)) {
        return { ...state, attr: 'end', value: recent, js };
      }
      return { ...state, value: recent, js };
    }
  }
}

/** The state after a run of author text. */
export function feedText(state: HtmlState, text: string): HtmlState {
  let current = state;
  for (const char of text) {
    current = step(current, char);
  }
  return current;
}

/** The context a runtime value lands in when written at `state`. */
export function contextAt(state: HtmlState): HtmlContext {
  switch (state.mode) {
    case 'data':
      return 'text';
    case 'raw':
      if (state.tag === 'script' || state.tag === '?') {
        return jsCodePosition(state.js ?? '') ? 'script' : 'script-string';
      }
      return state.tag === 'style' ? 'style' : 'rcdata';
    case 'comment':
      return 'rcdata';
    case 'before-value':
      return attributeContext(state.attr, '', 'unquoted');
    case 'value-unq':
      return attributeContext(state.attr, state.value, 'unquoted');
    case 'value-dq':
      return attributeContext(state.attr, state.value, 'dq');
    case 'value-sq':
      return attributeContext(state.attr, state.value, 'sq');
    default:
      return 'tag';
  }
}

function attributeContext(attr: string, value: string, quoting: 'dq' | 'sq' | 'unquoted'): HtmlContext {
  if (attr.includes('?') || attr.startsWith('on') || CODE_ATTRIBUTES.has(attr)) {
    return 'code-attr';
  }
  if (URL_ATTRIBUTES.has(attr)) {
    // `value` is the normalized prefix kept by `appendValue`.
    if (value === '!') {
      return 'code-attr';
    }
    if (value !== '#' && OPEN_SCHEME.test(value)) {
      return `url-${quoting}`;
    }
  }
  return `attr-${quoting}`;
}

/** The state after a runtime value of unknown text. */
export function feedValue(state: HtmlState): HtmlState {
  switch (state.mode) {
    case 'tag-open':
      return { mode: 'tag-name', tag: '?', attr: '', value: '' };
    case 'tag-name':
      return { ...state, tag: `${state.tag}?` };
    case 'before-attr':
    case 'after-attr':
      return { ...state, mode: 'attr-name', attr: '?', value: '' };
    case 'attr-name':
      return { ...state, attr: `${state.attr}?` };
    case 'before-value':
      return appendValue({ ...state, mode: 'value-unq', value: '' }, RUNTIME);
    case 'value-dq':
    case 'value-sq':
    case 'value-unq':
      // A runtime part may be scheme letters, so it keeps a scheme open.
      return appendValue(state, RUNTIME);
    case 'comment':
      return { ...state, value: `${state.value}\u0000` };
    case 'raw':
      return {
        ...state,
        attr: '',
        value: `${state.value}\u0000`,
        js: state.tag === 'script' || state.tag === '?' ? jsValue(state.js ?? '') : state.js,
      };
    default:
      return state;
  }
}

export function stateKey(state: HtmlState): string {
  return `${state.mode}\u0001${state.tag}\u0001${state.attr}\u0001${state.value}\u0001${state.js ?? ''}`;
}

/*
 * The JS lexer for script content. Its state is a stack of one-character
 * frames, innermost last, then `|` and the previous significant token, which
 * tells a regex `/` from a division `/`. Empty is top-level code at a start.
 *
 * Frames:
 *   `'` `"` `` ` ``  an open string or template
 *   `\`            an escape inside one: the next character is taken as is
 *   `$`            a `$` in a template, which `{` turns into an expression
 *   `{`            code inside a template's `${`, ended by its `}`
 *   `b`            a `{` block inside that code, so its `}` is not the end
 *   `P` `K`        an open `(`; `K` when it follows `if`, `while`, `for` or
 *                  `with`, whose `)` ends a head a regex may follow
 *   `T`            a `/` where a regex may start: `/` or `*` make a comment
 *   `~`            a `/` after an operand: a comment, or division
 *   `U`            a `/` of unknown kind: a comment, or else lost track
 *   `R` `C`        a regex body, and a `[...]` class inside it
 *   `/` `*`        a line or block comment; `+` is a `*` inside a block comment
 *   `?`            lost track: never a code position again
 *
 * Previous token: `r` (a regex may follow: the start, an operator,
 * punctuation, a reserved keyword, or the `)` of an `if (...)` head), `d`
 * (division follows: any other `)`, `]`, a string or regex end, a finished
 * name), `w<word>` (a name or number still being read), `x<word>` (the same,
 * ended by whitespace, so the next word starts afresh), `W` (a name that
 * cannot be a keyword: too long, or a property after `.`), `.` (just after a
 * dot), `p+` / `p-` (one `+` or `-`), `u` (unknown: `++`, `--`, a `}`, and
 * the rest). A `/` after an unknown token, a `.` or a contextual keyword
 * (`of`, `await`, `yield`, `let`, ...) is of unknown kind: a comment is still
 * read, anything else loses track, so the rule reports rather than guess.
 */
const MAX_JS_DEPTH = 24;
const LINE_ENDS = /[\n\r\u2028\u2029]/u;
const JS_SPACE = /\s/u;
const WORD_CHAR = /[\p{L}\p{N}_$]/u;
/** Punctuators after which a `/` starts a regex. */
const REGEX_AFTER: ReadonlySet<string> = new Set([...'(,=:[!&|?{};*%<>~^']);
/** Keywords after which a `/` starts a regex. */
const REGEX_KEYWORDS: ReadonlySet<string> = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
]);
/** Words that are keywords only in some places, so a `/` after them may be either. */
const CONTEXTUAL_KEYWORDS: ReadonlySet<string> = new Set(['of', 'await', 'yield', 'get', 'set', 'async', 'let', 'static']);
const LONGEST_KEYWORD = 10;
/** Keywords whose `(...)` head is followed by a statement, so a `/` after its `)` starts a regex. */
const HEAD_KEYWORDS: ReadonlySet<string> = new Set(['if', 'while', 'for', 'with']);

function splitJs(js: string): [stack: string, prev: string] {
  const bar = js.lastIndexOf('|');
  return bar === -1 ? [js, 'r'] : [js.slice(0, bar), js.slice(bar + 1)];
}

function joinJs(stack: string, prev: string): string {
  if (stack.includes('?')) {
    return '?';
  }
  if (stack.length > MAX_JS_DEPTH) {
    return '?';
  }
  return stack === '' && prev === 'r' ? '' : `${stack}|${prev}`;
}

/** True when a `/` after `prev` starts a regex, false for division, null when unknown. */
function slashStartsRegex(prev: string): boolean | null {
  if (prev === 'r' || prev === 'p+' || prev === 'p-') {
    return true;
  }
  if (prev === 'd' || prev === 'W') {
    return false;
  }
  const word = wordOf(prev);
  if (word !== null) {
    return CONTEXTUAL_KEYWORDS.has(word) ? null : REGEX_KEYWORDS.has(word);
  }
  return null;
}

/** The name or number `prev` holds, read or finished, when it may still be a keyword. */
function wordOf(prev: string): string | null {
  return prev.startsWith('w') || prev.startsWith('x') ? prev.slice(1) : null;
}

/** One character of code (top level, or inside a template's `${`). */
function jsCode(stack: string, prev: string, char: string): string {
  if (JS_SPACE.test(char)) {
    // Whitespace ends a word: `q\nreturn` is two words, not `qreturn`.
    if (prev.startsWith('w')) {
      return joinJs(stack, `x${prev.slice(1)}`);
    }
    return joinJs(stack, prev === 'W' ? 'd' : prev);
  }
  switch (char) {
    case "'":
    case '"':
    case '`':
      return joinJs(stack + char, prev);
    case '/': {
      const regex = slashStartsRegex(prev);
      return joinJs(stack + (regex === null ? 'U' : regex ? 'T' : '~'), prev);
    }
    case '{':
      return joinJs(stack.includes('{') ? `${stack}b` : stack, 'r');
    case '}': {
      const top = stack.at(-1);
      if (top === '{') {
        // Back to the template's text.
        return joinJs(stack.slice(0, -1), prev);
      }
      // A block or an expression (`({}) / 2`): a `/` after it is unknown.
      return joinJs(top === 'b' ? stack.slice(0, -1) : stack, 'u');
    }
    case '+':
    case '-':
      // `a++ / b` is division, `a + /b/` a regex: a doubled sign is unknown.
      return joinJs(stack, prev === `p${char}` ? 'u' : `p${char}`);
    case '(':
      return joinJs(stack + (HEAD_KEYWORDS.has(wordOf(prev) ?? '') ? 'K' : 'P'), 'r');
    case ')': {
      const top = stack.at(-1);
      if (top !== 'P' && top !== 'K') {
        // A `)` this lexer did not see open: unknown.
        return joinJs(stack, 'u');
      }
      return joinJs(stack.slice(0, -1), top === 'K' ? 'r' : 'd');
    }
    case ']':
      return joinJs(stack, 'd');
    case '.':
      return joinJs(stack, '.');
    default:
      break;
  }
  if (WORD_CHAR.test(char)) {
    // A property name after `.` is never a keyword (`a.return / 2`).
    if (prev === 'W' || prev === '.') {
      return joinJs(stack, 'W');
    }
    const word = prev.startsWith('w') ? prev.slice(1) + char : char;
    return joinJs(stack, word.length > LONGEST_KEYWORD ? 'W' : `w${word}`);
  }
  return joinJs(stack, REGEX_AFTER.has(char) ? 'r' : 'u');
}

/** The lexer state after one more character of author text. */
export function jsStep(js: string, char: string): string {
  const [stack, prev] = splitJs(js);
  if (stack.includes('?')) {
    return '?';
  }
  const top = stack.at(-1);
  const rest = stack.slice(0, -1);
  switch (top) {
    case '\\':
      return joinJs(rest, prev);
    case "'":
    case '"':
      if (char === '\\') {
        return joinJs(`${stack}\\`, prev);
      }
      return char === top || LINE_ENDS.test(char) ? joinJs(rest, 'd') : js;
    case '`':
      if (char === '\\' || char === '$') {
        return joinJs(stack + char, prev);
      }
      return char === '`' ? joinJs(rest, 'd') : js;
    case '$':
      // `${` opens an expression; anything else is template text again.
      return char === '{' ? joinJs(`${rest}{`, 'r') : jsStep(joinJs(rest, prev), char);
    case 'T':
      if (char === '/' || char === '*') {
        return joinJs(rest + char, prev);
      }
      // A regex body starts with this character.
      return jsStep(joinJs(`${rest}R`, prev), char);
    case '~':
      if (char === '/' || char === '*') {
        return joinJs(rest + char, prev);
      }
      // Division: the operator is behind, so a regex may follow.
      return jsCode(rest, 'r', char);
    case 'U':
      // A comment is still a comment; a regex or a division cannot be told apart.
      return char === '/' || char === '*' ? joinJs(rest + char, prev) : '?';
    case 'R':
      if (char === '\\' || char === '[') {
        return joinJs(stack + (char === '[' ? 'C' : '\\'), prev);
      }
      if (LINE_ENDS.test(char)) {
        return '?';
      }
      return char === '/' ? joinJs(rest, 'd') : js;
    case 'C':
      if (char === '\\') {
        return joinJs(`${stack}\\`, prev);
      }
      if (LINE_ENDS.test(char)) {
        return '?';
      }
      return char === ']' ? joinJs(rest, prev) : js;
    case '/':
      return LINE_ENDS.test(char) ? joinJs(rest, prev) : js;
    case '*':
      return char === '*' ? joinJs(`${stack}+`, prev) : js;
    case '+':
      if (char === '/') {
        return joinJs(rest.slice(0, -1), prev);
      }
      return char === '*' ? js : joinJs(rest, prev);
    default:
      return jsCode(stack, prev, char);
  }
}

/** The lexer state after a runtime value: an operand in code, a start of a regex body after a regex `/`. */
export function jsValue(js: string): string {
  const [stack, prev] = splitJs(js);
  if (stack.includes('?')) {
    return '?';
  }
  switch (stack.at(-1)) {
    case undefined:
    case '{':
    case 'b':
    case 'P':
    case 'K':
      return joinJs(stack, 'd');
    case '~':
      return joinJs(stack.slice(0, -1), 'd');
    case 'T':
      return joinJs(`${stack.slice(0, -1)}R`, prev);
    case 'U':
      return '?';
    case '$':
      return joinJs(stack.slice(0, -1), prev);
    case '\\':
      return joinJs(stack.slice(0, -1), prev);
    default:
      // Inside a string, template, regex or comment: assumed to stay there.
      return js;
  }
}

/** True when a value written at this lexer state stands as a JS expression. */
export function jsCodePosition(js: string): boolean {
  const [stack] = splitJs(js);
  const top = stack.at(-1);
  return (
    !stack.includes('?') &&
    (top === undefined || top === '{' || top === 'b' || top === 'P' || top === 'K' || top === '~')
  );
}
