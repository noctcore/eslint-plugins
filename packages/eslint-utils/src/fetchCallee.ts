import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

/*
 * One description of "a call that issues an HTTP request", shared by the rules
 * that care about fetch calls (timeouts, response checks, SSRF), so a consumer
 * declares a wrapper once, under one option name (`fetchCallees`), and passes
 * the same list to every rule.
 *
 * An entry is either a string or an object:
 *
 *   - `'fetch'`, `'http.fetchWithRetry'`, `'this.api.get'`: the callee as written.
 *     The last segment is the method, the rest is the receiver.
 *   - `{ name: 'get', object: 'axios', urlArgument: 0, urlProperty: 'url' }`:
 *     the same callee spelled out, plus where the URL sits (read only by rules
 *     that inspect the URL; default the first argument, or its `href`
 *     property when that argument is an object literal).
 */

/** A fetch-like callee: a function `name`, called on `object` when set. */
export interface FetchCalleeSpec {
  /** The called function or method name. */
  readonly name: string;
  /** The receiver as written (`axios`, `this.http`); absent for a bare call. */
  readonly object?: string;
  /** Which argument holds the URL: an index, or `'last'`. Default 0. */
  readonly urlArgument?: number | 'last';
  /** When the URL argument is an object literal, the property holding the URL. */
  readonly urlProperty?: string;
}

/** A `fetchCallees` entry as a consumer writes it. */
export type FetchCalleeEntry = string | FetchCalleeSpec;

/** JSON schema of one `fetchCallees` entry, string or object form. */
export const fetchCalleeEntrySchema: JSONSchema4 = {
  oneOf: [
    { type: 'string', minLength: 1 },
    {
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: { type: 'string', minLength: 1, description: 'The called function or method name.' },
        object: { type: 'string', minLength: 1, description: 'The receiver as written, such as `axios`.' },
        urlArgument: {
          oneOf: [{ type: 'integer', minimum: 0 }, { type: 'string', enum: ['last'] }],
          description: 'Which argument holds the URL: an index or `last`. Default 0.',
        },
        urlProperty: {
          type: 'string',
          minLength: 1,
          description: 'When the URL argument is an object literal, the property holding the URL. Default `href`.',
        },
      },
    },
  ],
};

/** JSON schema of a `fetchCallees` option, with the rule's own `description`. */
export function fetchCalleesSchema(description: string): JSONSchema4 {
  return { type: 'array', items: fetchCalleeEntrySchema, description };
}

function squash(text: string): string {
  return text.replace(/\s+/gu, '');
}

/** The object form of an entry: `'a.b.get'` becomes `{ object: 'a.b', name: 'get' }`. */
export function toFetchCalleeSpec(entry: FetchCalleeEntry): FetchCalleeSpec {
  if (typeof entry !== 'string') {
    return entry;
  }
  const text = squash(entry);
  const dot = text.lastIndexOf('.');
  return dot === -1 ? { name: text } : { object: text.slice(0, dot), name: text.slice(dot + 1) };
}

/** Every entry in object form. */
export function normalizeFetchCallees(entries: readonly FetchCalleeEntry[]): FetchCalleeSpec[] {
  return entries.map(toFetchCalleeSpec);
}

/**
 * The spec a call matches, or undefined. A bare call (`fetch(url)`) matches a
 * spec with no `object`; a non-computed member call (`axios.get(url)`) matches
 * on the method name plus the receiver's source text, whitespace ignored.
 */
export function matchFetchCallee(
  node: TSESTree.CallExpression,
  specs: readonly FetchCalleeSpec[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): FetchCalleeSpec | undefined {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return specs.find((spec) => spec.object === undefined && spec.name === callee.name);
  }
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return undefined;
  }
  const method = callee.property.name;
  const receiver = squash(sourceCode.getText(callee.object));
  return specs.find(
    (spec) => spec.object !== undefined && spec.name === method && squash(spec.object) === receiver,
  );
}

/** The callee as one string, for messages: `fetch`, `axios.get`. */
export function fetchCalleeText(spec: FetchCalleeSpec): string {
  return spec.object === undefined ? spec.name : `${squash(spec.object)}.${spec.name}`;
}
