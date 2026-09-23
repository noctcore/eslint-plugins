import { commentText, looksLikeJsDoc } from '../utils/comments';
import { createRule } from '../createRule';

const RULE_NAME = 'no-elided-code-comments';

type MessageIds = 'elidedCode';

const ELLIPSIS = /\.{2,}|…/u;
const ELLIPSIS_WRAPPED = /^\s*(?:\.{2,}|…).*(?:\.{2,}|…)\s*$/u;

/** Brackets and parentheses are dropped so `// (rest of file unchanged)` reads as its words. */
const BRACKETS = /[()[\]]/gu;

/** Leading and trailing ellipses, punctuation and space around the words of the comment. */
const EDGE_PUNCTUATION = /^[\s.…:,;!-]+|[\s.…:,;!-]+$/gu;

/** A tracked marker is a deliberate placeholder, not a silent deletion. */
const TRACKED_MARKER = /^(?:todo|fixme|xxx|hack)\b/iu;

/** Units of code: "other methods unchanged" can only mean code that was left out. */
const CODE_NOUN =
  '(?:code|logic|implementation|functions?|methods?|class(?:es)?|components?|file|module|body|imports|exports|handlers?|routes?|tests?|cases|types|interfaces|hooks|helpers|stuff)';

/*
 * Units of data: "other fields unchanged" is also how a test describes the
 * state it is about to assert on, so these need a stronger elision signal.
 */
const DATA_NOUN =
  '(?:properties|props|fields|members|state|config(?:uration)?|styles|content|setup|options)';

/** Words that say the code was left out of the text. */
const OMISSION = '(?:omitted|elided|for\\s+brevity|not\\s+shown|(?:goes?\\s+)?here)';

/** Words that say the code did not change, which data comments also say. */
const NO_CHANGE = '(?:unchanged|the\\s+same|as\\s+before|as\\s+is)';

const LEAD_IN = '(?:(?:keep|keeping|retain|preserve)\\s+)?(?:all\\s+)?(?:the\\s+)?';

const QUALIFIER = '(?:existing|previous|original|other|remaining|more|additional)';

function referencePattern(noun: string): RegExp {
  return new RegExp(
    `^${LEAD_IN}(?:(?:rest|remainder)\\s+of\\s+(?:the\\s+)?(?:\\w+\\s+)?${noun}|${QUALIFIER}\\s+(?:\\w+\\s+)?${noun})` +
      `(?:\\s+(?:(?:is|are|remains?|stays?)\\s+)?(?:(${OMISSION})|(${NO_CHANGE}))(?:\\s+for\\s+brevity)?)?$`,
    'iu',
  );
}

/*
 * "rest of the code" / "existing methods" / "other handlers". On its own a
 * whole-comment match of this shape can also be a section header ("// Other
 * helpers"), so it only counts with an ellipsis or an elision suffix, except
 * for the forms in STRONG_REFERENCE that nobody writes as a header.
 */
const CODE_REFERENCE = referencePattern(CODE_NOUN);
const DATA_REFERENCE = referencePattern(DATA_NOUN);

const STRONG_REFERENCE =
  /^(?:(?:keep|keeping|retain|preserve)\s+)?(?:all\s+)?(?:the\s+)?(?:(?:rest|remainder)\s+of\s+(?:the\s+)?(?:code|file|function|method|class|component|implementation|module)|existing\s+(?:code|implementation))$/iu;

/** "your code here", "implementation goes here", "validation logic goes here". */
const PLACEHOLDERS: readonly RegExp[] = [
  /^(?:(?:add|put|insert|write)\s+)?(?:your\s+(?:own\s+)?)?(?:\w+\s+)?(?:code|logic|implementation)\s+goes\s+here$/iu,
  /^(?:(?:add|put|insert|write)\s+)?your\s+(?:own\s+)?(?:\w+\s+)?(?:code|logic|implementation)\s+here$/iu,
];

/** "everything else unchanged", "rest remains the same". */
const REMAINDER_UNCHANGED =
  /^(?:everything\s+else|the\s+rest|rest)\s+(?:(?:is|remains?|stays?)\s+)?(?:unchanged|the\s+same|as\s+before)$/iu;

/*
 * A bare "unchanged" / "same as before" is only an elision marker when it is
 * wrapped as one: `// (unchanged)`, `// ... unchanged ...`. Plain
 * `// unchanged` next to a fixture field is an ordinary note.
 */
const BARE_UNCHANGED = /^(?:unchanged|same\s+as\s+before|as\s+before)$/iu;

function isElisionComment(text: string): boolean {
  if (TRACKED_MARKER.test(text)) {
    return false;
  }
  const hasEllipsis = ELLIPSIS.test(text);
  const wrapped = hasEllipsis || /[()[\]]/u.test(text);
  const words = text.replace(BRACKETS, ' ').replace(EDGE_PUNCTUATION, '').replace(/\s+/gu, ' ');
  if (words === '') {
    return false;
  }
  if (PLACEHOLDERS.some((pattern) => pattern.test(words)) || REMAINDER_UNCHANGED.test(words)) {
    return true;
  }
  if (wrapped && BARE_UNCHANGED.test(words)) {
    return true;
  }
  const code = CODE_REFERENCE.exec(words);
  if (code !== null) {
    const suffixed = code[1] !== undefined || code[2] !== undefined;
    return hasEllipsis || suffixed || STRONG_REFERENCE.test(words);
  }
  // Data needs an omission word, or ellipses on both sides: `// ... other props ...`.
  const data = DATA_REFERENCE.exec(words);
  return data !== null && (data[1] !== undefined || ELLIPSIS_WRAPPED.test(text));
}

export const noElidedCodeCommentsRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "Disallow comments that stand in for elided code ('// ... existing code ...', '// rest of the function unchanged', '// your code here'). They are what an agent leaves when it rewrites a file from an abbreviated draft, and the code they replaced has usually been deleted.",
    },
    schema: [],
    messages: {
      elidedCode:
        'Elided-code placeholder ({{snippet}}). The code this comment stands in for was probably deleted: restore it from version control, or remove the comment.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Program(): void {
        for (const comment of context.sourceCode.getAllComments()) {
          if (looksLikeJsDoc(comment)) {
            continue;
          }
          const text = commentText(comment);
          if (!isElisionComment(text)) {
            continue;
          }
          const snippet = text.length > 40 ? `${text.slice(0, 40)}...` : text;
          context.report({
            loc: comment.loc,
            messageId: 'elidedCode',
            data: { snippet },
          });
        }
      },
    };
  },
});
