import { AST_NODE_TYPES, unwrapTypeWrappers, type TSESTree } from '@noctcore/eslint-utils';

import { createRule } from '../createRule';

const RULE_NAME = 'presigned-post-requires-policy';

type MessageIds = 'optionsNotLiteral' | 'missingLengthRange' | 'missingContentType';

const FUNCTION_NAME = 'createPresignedPost';

/** True for `createPresignedPost(...)` or `<anything>.createPresignedPost(...)`. */
function isCreatePresignedPost(callee: TSESTree.Expression): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name === FUNCTION_NAME;
  }
  return (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === FUNCTION_NAME
  );
}

function stringValue(node: TSESTree.Node | null | undefined): string | null {
  return node?.type === AST_NODE_TYPES.Literal && typeof node.value === 'string' ? node.value : null;
}

/** The `Conditions` array literal of an options object literal, when written there. */
function conditionsOf(options: TSESTree.ObjectExpression): TSESTree.ArrayExpression | null {
  for (const member of options.properties) {
    if (
      member.type === AST_NODE_TYPES.Property &&
      !member.computed &&
      ((member.key.type === AST_NODE_TYPES.Identifier && member.key.name === 'Conditions') ||
        stringValue(member.key) === 'Conditions')
    ) {
      const value = unwrapTypeWrappers(member.value);
      return value.type === AST_NODE_TYPES.ArrayExpression ? value : null;
    }
  }
  return null;
}

/** The tuple conditions, as their elements; a spread or an object condition is not a tuple. */
function tuples(conditions: TSESTree.ArrayExpression): (TSESTree.Node | null)[][] {
  return conditions.elements.flatMap((element) => {
    const value = element === null ? null : unwrapTypeWrappers(element);
    return value?.type === AST_NODE_TYPES.ArrayExpression ? [value.elements] : [];
  });
}

/*
 * A presigned POST is a write capability handed to the browser, and its policy
 * is the only thing S3 checks when the upload arrives: no server code runs
 * between the client and the bucket. So every `createPresignedPost` states, in
 * literal `Conditions` at the call, a `['content-length-range', min, max]`
 * tuple (without it the client uploads any size) and an
 * `['eq', '$Content-Type', type]` tuple (without it the stored type is whatever
 * the client sends, `text/html` included). A policy built elsewhere and passed
 * by name is refused rather than followed, so the policy stays reviewable where
 * the capability is minted.
 */
export const presignedPostRequiresPolicyRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A `createPresignedPost` call must pin the upload size and Content-Type in literal `Conditions`.',
    },
    schema: [],
    messages: {
      optionsNotLiteral:
        'Write the presigned POST options as an object literal with a literal `Conditions` array here, so the upload policy is visible where the capability is minted.',
      missingLengthRange:
        "Add `['content-length-range', min, max]` to `Conditions`: without it the client may upload any size.",
      missingContentType:
        "Add `['eq', '$Content-Type', contentType]` to `Conditions`: without it the stored Content-Type is whatever the client sends.",
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node): void {
        if (!isCreatePresignedPost(node.callee)) {
          return;
        }
        const argument = node.arguments[1];
        const options = argument === undefined ? null : unwrapTypeWrappers(argument);
        const conditions =
          options?.type === AST_NODE_TYPES.ObjectExpression ? conditionsOf(options) : null;
        if (conditions === null) {
          context.report({ node, messageId: 'optionsNotLiteral' });
          return;
        }

        const policy = tuples(conditions);
        const hasLengthRange = policy.some(
          (tuple) => tuple.length === 3 && stringValue(tuple[0]) === 'content-length-range',
        );
        const hasContentType = policy.some(
          (tuple) =>
            tuple.length === 3 &&
            stringValue(tuple[0]) === 'eq' &&
            stringValue(tuple[1]) === '$Content-Type',
        );
        if (!hasLengthRange) {
          context.report({ node: conditions, messageId: 'missingLengthRange' });
        }
        if (!hasContentType) {
          context.report({ node: conditions, messageId: 'missingContentType' });
        }
      },
    };
  },
});
