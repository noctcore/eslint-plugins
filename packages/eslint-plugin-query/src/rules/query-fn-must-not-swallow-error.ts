import {
  enclosingFunction,
  forEachDescendant,
  isStaticMemberAccess,
  unwrapTypeWrappers,
  type VisitorKeys,
} from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { calleeName, queriesElements, staticName } from '../utils/ast';

const RULE_NAME = 'query-fn-must-not-swallow-error';

export interface QueryFnMustNotSwallowErrorOptions {
  /** Marker text of the comment that allows a fallback, written `// <marker>: <reason>`. */
  readonly allowComment?: string;
  /** Option keys whose inline function is checked, replacing the default `queryFn`. */
  readonly queryFnProperties?: readonly string[];
}

type RuleOptions = [QueryFnMustNotSwallowErrorOptions];
type MessageIds = 'catchReturnsValue' | 'catchHandlerReturnsValue';

/*
 * A `queryFn` that catches its own error and returns a fallback turns a failed
 * request into cached data: the query reports `success`, never reaches its
 * error state, never retries, and the screen shows an empty value as if the
 * server had answered.
 *
 * The rule starts at the hook call, reads the inline function given as
 * `queryFn`, and reports two shapes: a `return <value>` inside a `catch` clause
 * of that function, and a `.catch(() => value)` on the promise it returns.
 * Rethrowing, `Promise.reject(...)`, a bare `return` and `return undefined` are
 * left alone, as is any return inside a function nested in the catch.
 *
 * Returning `null` for an optional resource can be a real contract, so a
 * `// allow-silent: <reason>` comment on the line above the reported node
 * silences the report.
 *
 * The check is lexical: a queryFn given by name, a try/catch inside a helper
 * the queryFn calls, and the elements of `useQueries({ queries: ids.map(...) })`
 * are not read.
 */
const QUERY_HOOKS: readonly string[] = [
  'useQuery',
  'useInfiniteQuery',
  'useSuspenseQuery',
  'useSuspenseInfiniteQuery',
  'queryOptions',
];

const DEFAULT_ALLOW_COMMENT = 'allow-silent';
const DEFAULT_QUERY_FN_PROPERTIES: readonly string[] = ['queryFn'];

type InlineFn = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

function isInlineFn(node: TSESTree.Node): node is InlineFn {
  return (
    node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
    node.type === AST_NODE_TYPES.FunctionExpression
  );
}

/** The inline functions given under one of `properties` in a hook options object. */
function inlineQueryFns(node: TSESTree.Node, properties: ReadonlySet<string>): readonly InlineFn[] {
  const object = unwrapTypeWrappers(node);
  if (object.type !== AST_NODE_TYPES.ObjectExpression) return [];
  const fns: InlineFn[] = [];
  for (const property of object.properties) {
    if (property.type !== AST_NODE_TYPES.Property) continue;
    const name = staticName(property.key, property.computed);
    if (name === undefined || !properties.has(name)) continue;
    const value = unwrapTypeWrappers(property.value);
    if (isInlineFn(value)) fns.push(value);
  }
  return fns;
}

/** `x` for `await x` and `x as T`, repeatedly. */
function unwrapValue(node: TSESTree.Node): TSESTree.Node {
  let current = unwrapTypeWrappers(node);
  while (current.type === AST_NODE_TYPES.AwaitExpression) {
    current = unwrapTypeWrappers(current.argument);
  }
  return current;
}

/** True for a returned value that stands in for the result: not nothing, not `undefined`, not a rejection. */
function isFallbackValue(argument: TSESTree.Node | null | undefined): boolean {
  if (argument === null || argument === undefined) return false;
  const value = unwrapValue(argument);
  if (value.type === AST_NODE_TYPES.Identifier && value.name === 'undefined') return false;
  if (value.type === AST_NODE_TYPES.UnaryExpression && value.operator === 'void') return false;
  if (
    value.type === AST_NODE_TYPES.CallExpression &&
    isStaticMemberAccess(value.callee, 'Promise', 'reject')
  ) {
    return false;
  }
  return true;
}

/** True when `node` sits in a `catch` clause of `fn`, without a function in between. */
function insideCatchBody(node: TSESTree.Node, fn: InlineFn): boolean {
  for (let current = node.parent; current != null && current !== fn; current = current.parent) {
    if (current.type === AST_NODE_TYPES.CatchClause) return true;
  }
  return false;
}

/** The `return` statements that belong to `fn` itself, not to a function nested in it. */
function ownReturns(fn: InlineFn, keys: VisitorKeys): readonly TSESTree.ReturnStatement[] {
  const returns: TSESTree.ReturnStatement[] = [];
  forEachDescendant(fn.body, keys, (node) => {
    if (node.type === AST_NODE_TYPES.ReturnStatement && enclosingFunction(node) === fn) {
      returns.push(node);
    }
  });
  return returns;
}

/** The handler of `.catch(handler)` when `expression` is that call and the handler returns a fallback. */
function swallowingHandler(expression: TSESTree.Node, keys: VisitorKeys): InlineFn | undefined {
  const call = unwrapValue(expression);
  if (call.type !== AST_NODE_TYPES.CallExpression) return undefined;
  const callee = call.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression) return undefined;
  if (staticName(callee.property, callee.computed) !== 'catch') return undefined;
  const first = call.arguments[0];
  if (first === undefined) return undefined;
  const handler = unwrapTypeWrappers(first);
  if (!isInlineFn(handler)) return undefined;
  if (handler.body.type !== AST_NODE_TYPES.BlockStatement) {
    return isFallbackValue(handler.body) ? handler : undefined;
  }
  return ownReturns(handler, keys).some((ret) => isFallbackValue(ret.argument))
    ? handler
    : undefined;
}

export const queryFnMustNotSwallowErrorRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow a `queryFn` that catches its error and returns a fallback value, which turns a failed request into cached data the query reports as a success.',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowComment: {
            type: 'string',
            minLength: 1,
            description:
              'Marker text of the comment that allows a fallback. A `// allow-silent: <reason>` comment with a non-empty reason on the line directly above the reported node silences the report. Defaults to `allow-silent`.',
          },
          queryFnProperties: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            minItems: 1,
            description:
              'Option keys whose inline function is checked. Replaces the default `["queryFn"]` and applies to the hooks, `queryOptions` and each `useQueries` element.',
          },
        },
      },
    ],
    messages: {
      catchReturnsValue:
        'This catch returns a value instead of rethrowing, so a failed request is cached as a success and the query never reaches its error state or retries. Rethrow the error, or add `// {{marker}}: <reason>` on the line above when the fallback is a real contract.',
      catchHandlerReturnsValue:
        'This `.catch` handler returns a value instead of rethrowing, so a failed request is cached as a success and the query never reaches its error state or retries. Rethrow the error, or add `// {{marker}}: <reason>` on the line above when the fallback is a real contract.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const marker = options.allowComment ?? DEFAULT_ALLOW_COMMENT;
    const properties = new Set(options.queryFnProperties ?? DEFAULT_QUERY_FN_PROPERTIES);
    const keys = context.sourceCode.visitorKeys;

    const commentsByEndLine = new Map<number, TSESTree.Comment[]>();
    for (const comment of context.sourceCode.getAllComments()) {
      const list = commentsByEndLine.get(comment.loc.end.line) ?? [];
      list.push(comment);
      commentsByEndLine.set(comment.loc.end.line, list);
    }

    const prefix = `${marker}:`;
    const hasAllowComment = (node: TSESTree.Node): boolean =>
      (commentsByEndLine.get(node.loc.start.line - 1) ?? []).some((comment) => {
        const text = comment.value.trimStart();
        return text.startsWith(prefix) && text.slice(prefix.length).trim() !== '';
      });

    const reportHandler = (handler: InlineFn): void => {
      if (hasAllowComment(handler)) return;
      context.report({ node: handler, messageId: 'catchHandlerReturnsValue', data: { marker } });
    };

    const checkQueryFn = (fn: InlineFn): void => {
      if (fn.body.type !== AST_NODE_TYPES.BlockStatement) {
        const handler = swallowingHandler(fn.body, keys);
        if (handler !== undefined) reportHandler(handler);
        return;
      }
      for (const ret of ownReturns(fn, keys)) {
        if (insideCatchBody(ret, fn)) {
          if (!isFallbackValue(ret.argument) || hasAllowComment(ret)) continue;
          context.report({ node: ret, messageId: 'catchReturnsValue', data: { marker } });
        } else if (ret.argument !== null) {
          const handler = swallowingHandler(ret.argument, keys);
          if (handler !== undefined) reportHandler(handler);
        }
      }
    };

    return {
      CallExpression(node): void {
        const first = node.arguments[0];
        if (first === undefined) return;
        const name = calleeName(node);
        if (name === undefined) return;
        if (QUERY_HOOKS.includes(name)) {
          for (const fn of inlineQueryFns(first, properties)) checkQueryFn(fn);
        } else if (name === 'useQueries') {
          for (const query of queriesElements(first)) {
            for (const fn of inlineQueryFns(query, properties)) checkQueryFn(fn);
          }
        }
      },
    };
  },
});
