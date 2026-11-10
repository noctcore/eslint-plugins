import { matchesAnyGlob } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'enforce-context-consumption';

/** One registered context: the hook that reads it, where it applies, and what it supplies. */
export interface ContextRegistryEntry {
  /** The consumer hook (`useTaskActions`), named in the message. */
  readonly hook: string;
  /** File-path globs where the context is available, so re-threading its values is a defect. */
  readonly files: readonly string[];
  /** The prop names the context supplies. */
  readonly providedProps: readonly string[];
}

export interface EnforceContextConsumptionOptions {
  readonly contexts?: readonly ContextRegistryEntry[];
}

type RuleOptions = [EnforceContextConsumptionOptions];
type MessageIds = 'reThreaded';

/*
 * Once a scoped context replaces a drilled bundle of props, nothing stops the
 * props from coming back: the next component that needs `onDelete` takes it as
 * a prop, its parent threads it down, and the refactor quietly unwinds. This
 * rule keeps it replaced. In files where a registered context applies, a prop
 * whose name the context supplies is a re-thread, and the fix is to read the
 * context instead.
 *
 * Two shapes are checked: a member of an interface or object type alias whose
 * name ends in `Props`, and a property destructured from a function's first
 * parameter when that parameter is annotated with a `*Props` type reference.
 * The registry is the whole signal: with no `contexts` the rule checks nothing,
 * so it is left out of `recommended`. A file where the provider is rendered
 * (the composition root) should simply not match the entry's `files`. Never
 * autofixed: where the context is consumed is a design decision.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    contexts: {
      type: 'array',
      description: 'The registered contexts. Without entries the rule checks nothing.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['hook', 'files', 'providedProps'],
        properties: {
          hook: {
            type: 'string',
            description: 'The hook that reads the context, named in the message.',
          },
          files: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            minItems: 1,
            description: 'File-path globs where the context is available.',
          },
          providedProps: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description: 'The prop names the context supplies.',
          },
        },
      },
    },
  },
};

type FunctionLike =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

/** Each identifier-keyed member of a type, as a reportable node and name. */
function typeMemberNames(
  members: readonly TSESTree.TypeElement[],
): { node: TSESTree.Node; name: string }[] {
  const out: { node: TSESTree.Node; name: string }[] = [];
  for (const member of members) {
    if (
      (member.type === AST_NODE_TYPES.TSPropertySignature ||
        member.type === AST_NODE_TYPES.TSMethodSignature) &&
      !member.computed &&
      member.key.type === AST_NODE_TYPES.Identifier
    ) {
      out.push({ node: member.key, name: member.key.name });
    }
  }
  return out;
}

/** The first parameter's object pattern when it is annotated with a `*Props` type. */
function propsPattern(node: FunctionLike): TSESTree.ObjectPattern | null {
  const param = node.params[0];
  if (param?.type !== AST_NODE_TYPES.ObjectPattern) {
    return null;
  }
  const annotation = param.typeAnnotation?.typeAnnotation;
  if (
    annotation?.type !== AST_NODE_TYPES.TSTypeReference ||
    annotation.typeName.type !== AST_NODE_TYPES.Identifier ||
    !annotation.typeName.name.endsWith('Props')
  ) {
    return null;
  }
  return param;
}

export const enforceContextConsumptionRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A prop whose value a registered scoped context already supplies must be read from the context, not declared or destructured as a prop again.',
      requiresOptions: true,
    },
    schema: [optionSchema],
    messages: {
      reThreaded:
        "'{{name}}' is provided by {{hook}}(). Read it from the context instead of threading it through props.",
    },
  },
  defaultOptions: [{ contexts: [] }],
  create(context, [options]) {
    // Prop name -> hook, for the contexts that apply to this file. The first entry wins.
    const providedBy = new Map<string, string>();
    for (const entry of options.contexts ?? []) {
      if (!matchesAnyGlob(context.filename, entry.files)) {
        continue;
      }
      for (const prop of entry.providedProps) {
        if (!providedBy.has(prop)) {
          providedBy.set(prop, entry.hook);
        }
      }
    }
    if (providedBy.size === 0) {
      return {};
    }

    function report(node: TSESTree.Node, name: string): void {
      const hook = providedBy.get(name);
      if (hook !== undefined) {
        context.report({ node, messageId: 'reThreaded', data: { name, hook } });
      }
    }

    function checkMembers(members: readonly TSESTree.TypeElement[]): void {
      for (const { node, name } of typeMemberNames(members)) {
        report(node, name);
      }
    }

    function checkFunction(node: FunctionLike): void {
      const pattern = propsPattern(node);
      if (pattern === null) {
        return;
      }
      for (const property of pattern.properties) {
        if (
          property.type === AST_NODE_TYPES.Property &&
          !property.computed &&
          property.key.type === AST_NODE_TYPES.Identifier
        ) {
          report(property.key, property.key.name);
        }
      }
    }

    return {
      TSInterfaceDeclaration(node): void {
        if (node.id.name.endsWith('Props')) {
          checkMembers(node.body.body);
        }
      },
      TSTypeAliasDeclaration(node): void {
        if (
          node.id.name.endsWith('Props') &&
          node.typeAnnotation.type === AST_NODE_TYPES.TSTypeLiteral
        ) {
          checkMembers(node.typeAnnotation.members);
        }
      },
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
});
