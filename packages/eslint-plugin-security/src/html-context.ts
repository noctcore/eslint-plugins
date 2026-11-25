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
  /**
   * In a `script` start tag, what its first `type` attribute makes it: `data`
   * for a data block (`application/json`, ...) the browser never runs,
   * kept on its raw content. In a `meta` start tag, `refresh` when its first
   * `http-equiv` is `refresh` (or unknown), so `content` holds a URL.
   */
  readonly kind?: 'js' | 'data' | 'refresh' | 'plain';
  /** In script content, the HTML escape state: `e` after `<!--`, `d` after a `<script` in that. */
  readonly esc?: 'e' | 'd';
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
 * `type` values that make a data block no script ever runs: JSON and plain
 * text. Every other type keeps the script reading: a JavaScript MIME type,
 * `module`, the blocks the browser reads itself (`importmap` maps module URLs,
 * `speculationrules`), types a library compiles and runs (`text/babel`,
 * `text/x-template` for Vue, which reads `{{ }}` in it), and a JavaScript type
 * with parameters (`text/javascript; charset=utf-8`).
 */
const DATA_TYPES = /^(?:application\/(?:[a-z\d.-]+\+)?json|text\/json|text\/plain)$/u;
const MAX_TYPE_LENGTH = 64;
/** The longest URL prefix kept while it may still become a scheme. */
const MAX_PREFIX = 256;
/** The attribute that decides what a start tag is: a script's `type`, a meta's `http-equiv`. */
const KIND_ATTRIBUTES: Readonly<Record<string, string>> = { script: 'type', meta: 'http-equiv' };
/** Frame and embedding attributes, where a `data:` URL loads a page of its own. */
const DOCUMENT_URLS: Readonly<Record<string, string>> = { iframe: 'src', frame: 'src', embed: 'src', object: 'data' };
/** SVG animation elements and the attributes that can set a URL (`attributeName="href"`). */
const ANIMATION_TAGS: ReadonlySet<string> = new Set(['animate', 'set']);
const ANIMATION_VALUES: ReadonlySet<string> = new Set(['to', 'from', 'by', 'values']);
/** A meta refresh `content` before its URL: the delay, a separator and `url=` (all optional). */
const REFRESH_HEAD = /^[\t\n\f\r ]*[\d.]*[\t\n\f\r ]*[;,]?[\t\n\f\r ]*(?:url[\t\n\f\r ]*=[\t\n\f\r ]*)?['"]?/iu;
/** A meta refresh `content` that may still be in its head. */
const PARTIAL_REFRESH = /^[\t\n\f\r ]*[\d.]*[\t\n\f\r ]*(?:[;,][\t\n\f\r ]*)?(?:u(?:r(?:l[\t\n\f\r ]*)?)?)?$/iu;
/** A character reference not finished yet at the end of the text. */
const PARTIAL_REFERENCE = /&(?:#(?:x[\da-f]*|\d*)|[a-z\d]*)$/iu;
const NAMED_REFERENCES: Readonly<Record<string, string>> = { colon: ':', Tab: '\t', NewLine: '\n' };

/** True when the value of the current attribute is a URL. */
function isUrlState(state: HtmlState): boolean {
  return (
    URL_ATTRIBUTES.has(state.attr) ||
    (state.tag === 'meta' && state.attr === 'content' && state.kind === 'refresh') ||
    (ANIMATION_TAGS.has(state.tag) && ANIMATION_VALUES.has(state.attr))
  );
}

/** Decodes the character references that can spell a scheme: numeric ones, `&colon;`, `&Tab;`, `&NewLine;`. */
function decodeReferences(text: string): string {
  return text.replace(/&#(?:x([\da-f]+)|(\d+));?|&(colon|Tab|NewLine);/giu, (match, hex?: string, decimal?: string, name?: string) => {
    if (name !== undefined) {
      return NAMED_REFERENCES[name] ?? match;
    }
    const code = hex === undefined ? Number(decimal) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '\uFFFD';
  });
}

/**
 * The URL a kept attribute value starts with, decoded and normalized the way
 * the browser reads it, or null while a character reference or a meta
 * refresh head may still change it.
 */
function urlPrefix(state: HtmlState, raw: string): string | null {
  if (PARTIAL_REFERENCE.test(raw)) {
    return null;
  }
  let url = decodeReferences(raw);
  if (state.tag === 'meta') {
    if (PARTIAL_REFRESH.test(url)) {
      return null;
    }
    url = url.replace(REFRESH_HEAD, '');
  }
  // Browsers drop leading spaces and controls and every tab or newline.
  return url.replace(/^[\u0000-\u0020]+/u, '').replace(/[\t\n\r]/gu, '');
}

/**
 * Appends to an attribute value, keeping only what decides its context: the
 * raw text of a URL attribute while it may still become a scheme, then `#`
 * for a fixed scheme or a path, or `!` when the scheme is script, a `data:`
 * page in a frame, or was built from a runtime part (`${p}:...`), whose
 * body is then code. Nothing is kept for other attributes, but a script's
 * `type` and a meta's `http-equiv`.
 */
function appendValue(state: HtmlState, text: string): HtmlState {
  if (KIND_ATTRIBUTES[state.tag] === state.attr && state.kind === undefined) {
    return { ...state, value: (state.value + text).slice(0, MAX_TYPE_LENGTH + 1) };
  }
  if (!isUrlState(state)) {
    return state.value === '' ? state : { ...state, value: '' };
  }
  let raw = state.value + text;
  if (state.attr === 'values' && text.includes(';')) {
    // Each `;` starts another value of the animation.
    raw = text.slice(text.lastIndexOf(';') + 1);
  } else if (state.value === '#' || state.value === '!') {
    return state;
  }
  const prefix = urlPrefix(state, raw);
  if (prefix === null || OPEN_SCHEME.test(prefix)) {
    return { ...state, value: raw.length > MAX_PREFIX ? '#' : raw };
  }
  const scheme = CLOSED_SCHEME.exec(prefix)?.[1];
  const code =
    scheme !== undefined &&
    (scheme.includes(RUNTIME) ||
      SCRIPT_SCHEMES.test(scheme) ||
      (scheme.toLowerCase() === 'data' && DOCUMENT_URLS[state.tag] === state.attr));
  return { ...state, value: code ? '!' : '#' };
}

/** The state after an attribute value ends, a script's `type` or a meta's `http-equiv` read. */
function endValue(state: HtmlState): HtmlState {
  const next: HtmlState = { ...state, value: '' };
  if (KIND_ATTRIBUTES[state.tag] !== state.attr || state.kind !== undefined) {
    return next;
  }
  // Browsers trim the value and ignore ASCII case; a runtime part may be anything, and a
  // character reference (`text&#47;javascript`) is decoded before the type is read.
  const type = state.value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, '').toLowerCase();
  const known = !type.includes(RUNTIME) && !type.includes('&') && type.length <= MAX_TYPE_LENGTH;
  if (state.tag === 'meta') {
    return { ...next, kind: known && type !== 'refresh' ? 'plain' : 'refresh' };
  }
  return { ...next, kind: known && DATA_TYPES.test(type) ? 'data' : 'js' };
}

function closeStartTag(state: HtmlState): HtmlState {
  const tag = state.tag;
  if (tag.includes('?')) {
    return { mode: 'raw', tag: '?', attr: '', value: '' };
  }
  if (tag === 'script' && state.kind === 'data') {
    return { mode: 'raw', tag, attr: '', value: '', kind: 'data' };
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
      return char === '"' ? endValue({ ...state, mode: 'before-attr' }) : appendValue(state, char);
    case 'value-sq':
      return char === "'" ? endValue({ ...state, mode: 'before-attr' }) : appendValue(state, char);
    case 'value-unq':
      if (SPACE.test(char)) {
        return endValue({ ...state, mode: 'before-attr' });
      }
      if (char === '>') {
        return closeStartTag(endValue(state));
      }
      return appendValue(state, char);
    case 'comment': {
      // `value` keeps the last four characters, from the comment's start:
      // `<!-->` and `<!--->` end it at once, then `-->` or `--!>`.
      const recent = (state.value + char).slice(-4);
      const ends = char === '>' && (recent === '>' || recent === '->' || recent.endsWith('-->') || recent === '--!>');
      return ends ? START_STATE : { ...state, value: recent };
    }
    case 'raw': {
      // `value` keeps the recent text; a pending end tag (`attr` `end`) or
      // `<script` (`open`) waits for its delimiter. `</script>` ends the
      // element even inside a JS string, so the lexer only runs alongside the
      // end tag check.
      const js = runsScript(state) ? jsStep(state.js ?? '', char) : undefined;
      const recent = (state.value + char).slice(-16);
      const delimiter = SPACE.test(char) || char === '/' || char === '>';
      if (state.attr === 'end') {
        if (state.esc === 'd') {
          // In a double-escaped script, `</script>` only steps back to the escaped state.
          return { ...state, attr: '', value: recent, js, esc: delimiter ? 'e' : 'd' };
        }
        if (SPACE.test(char) || char === '/') {
          return { mode: 'end-tag', tag: '', attr: '', value: '' };
        }
        if (char === '>') {
          return START_STATE;
        }
        if (state.tag === '?') {
          return { mode: 'end-tag', tag: '', attr: '', value: '' };
        }
        return { ...state, attr: '', value: recent, js };
      }
      if (state.attr === 'open') {
        return { ...state, attr: '', value: recent, js, esc: delimiter ? 'd' : state.esc };
      }
      let esc = state.esc;
      if (state.tag === 'script') {
        // Script data escape states: `<!--` escapes, `-->` leaves either escaped state.
        if (esc === undefined && recent.endsWith('<!--')) {
          esc = 'e';
        } else if (esc !== undefined && recent.endsWith('-->')) {
          esc = undefined;
        }
      }
      const next: HtmlState = { ...state, value: recent, js, esc };
      if (esc === 'e' && recent.toLowerCase().endsWith('<script')) {
        return { ...next, attr: 'open' };
      }
      if (endsWithEndTagOpen(recent, state.tag)) {
        return { ...next, attr: 'end' };
      }
      return next;
    }
  }
}

/** True for raw content the JS lexer reads: a script that runs, or an unknown element. */
function runsScript(state: HtmlState): boolean {
  return state.tag === '?' || (state.tag === 'script' && state.kind !== 'data');
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
      if (runsScript(state)) {
        return jsCodePosition(state.js ?? '') ? 'script' : 'script-string';
      }
      return state.tag === 'style' ? 'style' : 'rcdata';
    case 'comment':
      return 'rcdata';
    case 'before-value':
      return attributeContext({ ...state, value: '' }, 'unquoted');
    case 'value-unq':
      return attributeContext(state, 'unquoted');
    case 'value-dq':
      return attributeContext(state, 'dq');
    case 'value-sq':
      return attributeContext(state, 'sq');
    default:
      return 'tag';
  }
}

function attributeContext(state: HtmlState, quoting: 'dq' | 'sq' | 'unquoted'): HtmlContext {
  const { attr, value } = state;
  if (attr.includes('?') || attr.startsWith('on') || CODE_ATTRIBUTES.has(attr)) {
    return 'code-attr';
  }
  if (isUrlState(state)) {
    // `value` is the raw prefix kept by `appendValue`, or `#` / `!` once decided.
    if (value === '!') {
      return 'code-attr';
    }
    if (value !== '#') {
      // A value written inside a character reference or a refresh head may still start the URL.
      const prefix = urlPrefix(state, value);
      if (prefix === null || OPEN_SCHEME.test(prefix)) {
        return `url-${quoting}`;
      }
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
        js: runsScript(state) ? jsValue(state.js ?? '') : state.js,
      };
    default:
      return state;
  }
}

export function stateKey(state: HtmlState): string {
  return `${state.mode}\u0001${state.tag}\u0001${state.attr}\u0001${state.value}\u0001${state.js ?? ''}\u0001${state.kind ?? ''}\u0001${state.esc ?? ''}`;
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
 *   `E`            a `\u` escape in a name, which makes it no keyword
 *   `?`            lost track: never a code position again
 *
 * Previous token: `r` (a regex may follow: the start, an operator,
 * punctuation, a reserved keyword, or the `)` of an `if (...)` head), `d`
 * (division follows: any other `)`, `]`, a string or regex end, a finished
 * name), `w<word>` (a name or number still being read), `x<word>` (the same,
 * ended by whitespace, so the next word starts afresh), `W` (a name that
 * cannot be a keyword: too long, or a property after `.`), `.` (just after a
 * dot), `..` (two dots of a spread), `p+` / `p-` (one `+` or `-`), `u` (unknown: `++`, `--`, a `}`, and
 * the rest). A `/` after an unknown token, a `.` or a contextual keyword
 * (`of`, `await`, `yield`, `let`, ...) is of unknown kind: a comment is still
 * read, anything else loses track, so the rule reports rather than guess.
 */
const MAX_JS_DEPTH = 24;
const LINE_ENDS = /[\n\r\u2028\u2029]/u;
const JS_SPACE = /\s/u;
/** A character that continues a name or number: ID_Continue, `$`, ZWNJ and ZWJ. */
const WORD_CHAR = /[\p{ID_Continue}$\u200C\u200D]/u;
/** Characters a `\u` escape in a name is read through. */
const ESCAPE_CHAR = /[\da-f{u]/iu;
/** Punctuators after which a `/` starts a regex (`(`, `{` and `}` have their own cases). */
const REGEX_AFTER: ReadonlySet<string> = new Set([...',=:[!&|?;*%<>~^']);
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
  'default',
  'extends',
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

/** The previous token once a space or comment ends it: a name being read is finished. */
function endWord(prev: string): string {
  if (prev.startsWith('w')) {
    return `x${prev.slice(1)}`;
  }
  return prev === 'W' ? 'd' : prev;
}

/** The name or number `prev` holds, read or finished, when it may still be a keyword. */
function wordOf(prev: string): string | null {
  return prev.startsWith('w') || prev.startsWith('x') ? prev.slice(1) : null;
}

/** One character of code (top level, or inside a template's `${`). */
function jsCode(stack: string, prev: string, char: string): string {
  if (JS_SPACE.test(char)) {
    // Whitespace ends a word: `q\nreturn` is two words, not `qreturn`.
    return joinJs(stack, endWord(prev));
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
      // The dot of a number (`1.`) ends an operand; one of a spread (`...`) is an operator.
      if (/^w\d/u.test(prev)) {
        return joinJs(stack, 'd');
      }
      if (prev === '.') {
        return joinJs(stack, '..');
      }
      return joinJs(stack, prev === '..' ? 'r' : '.');
    case '#':
      // A private name (`this.#in`) is never a keyword.
      return joinJs(stack, '.');
    case '\\':
      return joinJs(`${stack}E`, 'W');
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
    case 'E':
      if (char === '}') {
        return joinJs(rest, 'W');
      }
      return ESCAPE_CHAR.test(char) ? js : jsStep(joinJs(rest, 'W'), char);
    case '/':
      return LINE_ENDS.test(char) ? joinJs(rest, endWord(prev)) : js;
    case '*':
      return char === '*' ? joinJs(`${stack}+`, prev) : js;
    case '+':
      if (char === '/') {
        return joinJs(rest.slice(0, -1), endWord(prev));
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
