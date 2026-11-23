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
    case 'raw':
      return { ...state, attr: state.mode === 'raw' ? '' : state.attr, value: `${state.value}\u0000` };
    default:
      return state;
  }
}

export function stateKey(state: HtmlState): string {
  return `${state.mode}\u0001${state.tag}\u0001${state.attr}\u0001${state.value}\u0001${state.js ?? ''}`;
}

/*
 * The JS lexer for script content, kept as a stack of one-character frames,
 * innermost last. Empty is top-level code. Frames:
 *   `'` `"` `` ` ``  an open string or template
 *   `\`            an escape inside one: the next character is taken as is
 *   `$`            a `$` in a template, which `{` turns into an expression
 *   `{`            code inside a template's `${`, ended by its `}`
 *   `b`            a `{` block inside that code, so its `}` is not the end
 *   `~`            a `/` in code, which `/` or `*` turns into a comment
 *   `/` `*`        a line or block comment; `+` is a `*` inside a block comment
 *   `?`            lost track (too deep): never a code position
 * A regex literal is read as code, so a quote in one opens a string: that can
 * only report more, never less.
 */
const MAX_JS_DEPTH = 24;
const LINE_ENDS = /[\n\r\u2028\u2029]/u;

function jsCode(js: string, char: string): string {
  switch (char) {
    case "'":
    case '"':
    case '`':
      return js + char;
    case '/':
      return `${js}~`;
    case '{':
      return js.includes('{') ? `${js}b` : js;
    case '}': {
      const top = js.at(-1);
      return top === 'b' || top === '{' ? js.slice(0, -1) : js;
    }
    default:
      return js;
  }
}

/** The lexer state after one more character of author text. */
export function jsStep(js: string, char: string): string {
  if (js.endsWith('?')) {
    return js;
  }
  const top = js.at(-1);
  const rest = js.slice(0, -1);
  let next: string;
  switch (top) {
    case '\\':
      next = rest;
      break;
    case "'":
    case '"':
      next = char === '\\' ? `${js}\\` : char === top || LINE_ENDS.test(char) ? rest : js;
      break;
    case '`':
      next = char === '\\' ? `${js}\\` : char === '`' ? rest : char === '$' ? `${js}$` : js;
      break;
    case '$':
      // `${` opens an expression; anything else is template text again.
      next = char === '{' ? `${rest}{` : jsStep(rest, char);
      break;
    case '~':
      next = char === '/' ? `${rest}/` : char === '*' ? `${rest}*` : jsCode(rest, char);
      break;
    case '/':
      next = LINE_ENDS.test(char) ? rest : js;
      break;
    case '*':
      next = char === '*' ? `${js}+` : js;
      break;
    case '+':
      next = char === '/' ? rest.slice(0, -1) : char === '*' ? js : rest;
      break;
    default:
      // Code: top-level, or inside a template's `${` (`{`, `b`).
      next = jsCode(js, char);
  }
  return next.length > MAX_JS_DEPTH ? '?' : next;
}

/** True when a value written at this lexer state stands as a JS expression. */
export function jsCodePosition(js: string): boolean {
  const top = js.at(-1);
  return top === undefined || top === '{' || top === 'b' || top === '~';
}
