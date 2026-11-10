import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';

const RULE_NAME = 'password-input-requires-autocomplete';

type MessageIds = 'missingAutocomplete';

/*
 * A password field with no `autoComplete` renders, validates and submits
 * exactly like one that has it, so nothing on the developer's screen says it
 * is wrong. What breaks is the password manager: it cannot tell a sign-in field
 * from a new-password field, so it neither fills the current password nor
 * offers to save the new one (WCAG 1.3.5 identify input purpose, 3.3.8
 * accessible authentication). `jsx-a11y/autocomplete-valid` checks a value
 * that is present; nothing checks that one is there at all.
 *
 * A password field is any JSX element, intrinsic or component, whose `type`
 * can be the string "password": a literal, a braced literal, either branch of
 * a conditional (the show/hide toggle), or a `const` in scope initialised to
 * one of those. A wrapper that takes `type="password"` forwards it to an
 * input, so it needs the purpose too.
 *
 * A spread does not count as the attribute. Form libraries spread a field
 * object (`{...field}`, `{...register('password')}`) that never carries
 * `autoComplete`, so treating a spread as "maybe it is in there" would exempt
 * the commonest real case. An `autoComplete` that names no purpose (bare,
 * empty, `{undefined}`, `{null}`) is reported like a missing one.
 */

const PASSWORD_TYPE = 'password';

/** The JSX attribute with one of `names`, ignoring spreads and namespaced names. */
function findAttribute(
  node: TSESTree.JSXOpeningElement,
  names: readonly string[],
): TSESTree.JSXAttribute | undefined {
  return node.attributes.find(
    (attribute): attribute is TSESTree.JSXAttribute =>
      attribute.type === AST_NODE_TYPES.JSXAttribute &&
      attribute.name.type === AST_NODE_TYPES.JSXIdentifier &&
      names.includes(attribute.name.name),
  );
}

/** The initialiser of the `const` that `identifier` resolves to, or null. */
function constInitializer(
  identifier: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Expression | null {
  const variable = ASTUtils.findVariable(sourceCode.getScope(identifier), identifier);
  const definition = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (
    definition?.node.type === AST_NODE_TYPES.VariableDeclarator &&
    definition.parent?.type === AST_NODE_TYPES.VariableDeclaration &&
    definition.parent.kind === 'const' &&
    definition.node.init !== null
  ) {
    return definition.node.init;
  }
  return null;
}

/** True when `expression` can evaluate to the string "password". */
function canBePassword(
  expression: TSESTree.Expression,
  sourceCode: Readonly<TSESLint.SourceCode>,
  seen: Set<TSESTree.Node>,
): boolean {
  if (seen.has(expression)) {
    return false;
  }
  seen.add(expression);
  switch (expression.type) {
    case AST_NODE_TYPES.Literal:
      return expression.value === PASSWORD_TYPE;
    case AST_NODE_TYPES.TemplateLiteral:
      return (
        expression.expressions.length === 0 && expression.quasis[0]?.value.cooked === PASSWORD_TYPE
      );
    case AST_NODE_TYPES.ConditionalExpression:
      return (
        canBePassword(expression.consequent, sourceCode, seen) ||
        canBePassword(expression.alternate, sourceCode, seen)
      );
    case AST_NODE_TYPES.TSAsExpression:
    case AST_NODE_TYPES.TSSatisfiesExpression:
      return canBePassword(expression.expression, sourceCode, seen);
    case AST_NODE_TYPES.Identifier: {
      const init = constInitializer(expression, sourceCode);
      return init !== null && canBePassword(init, sourceCode, seen);
    }
    default:
      return false;
  }
}

/** True when the `type` attribute's value can be "password". */
function isPasswordType(
  attribute: TSESTree.JSXAttribute,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  const value = attribute.value;
  if (value === null) {
    return false;
  }
  if (value.type === AST_NODE_TYPES.Literal) {
    return value.value === PASSWORD_TYPE;
  }
  if (
    value.type === AST_NODE_TYPES.JSXExpressionContainer &&
    value.expression.type !== AST_NODE_TYPES.JSXEmptyExpression
  ) {
    return canBePassword(value.expression, sourceCode, new Set());
  }
  return false;
}

/**
 * True when an `autoComplete` attribute is written but names no purpose: bare
 * (`autoComplete`, which JSX reads as `true`), empty, `{undefined}` or
 * `{null}`. None renders a usable token.
 */
function isEmptyAutocomplete(attribute: TSESTree.JSXAttribute): boolean {
  const value = attribute.value;
  if (value === null) {
    return true;
  }
  if (value.type === AST_NODE_TYPES.Literal) {
    return value.value === '';
  }
  if (value.type !== AST_NODE_TYPES.JSXExpressionContainer) {
    return false;
  }
  const expression = value.expression;
  if (expression.type === AST_NODE_TYPES.JSXEmptyExpression) {
    return true;
  }
  if (expression.type === AST_NODE_TYPES.Identifier) {
    return expression.name === 'undefined';
  }
  if (expression.type === AST_NODE_TYPES.Literal) {
    return expression.value === null || expression.value === '';
  }
  return false;
}

export const passwordInputRequiresAutocompleteRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A password field must carry an explicit `autoComplete` purpose, so a password manager can fill the current password and save a new one.',
    },
    schema: [],
    messages: {
      missingAutocomplete:
        'Password field without an `autoComplete` purpose. A password manager cannot tell a sign-in field from a new-password field without it, so it neither fills nor saves (WCAG 1.3.5, 3.3.8). Add `autoComplete="current-password"` or `autoComplete="new-password"` explicitly; a spread such as `{...field}` does not carry it.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      JSXOpeningElement(node): void {
        const typeAttribute = findAttribute(node, ['type']);
        if (typeAttribute === undefined || !isPasswordType(typeAttribute, context.sourceCode)) {
          return;
        }
        const autocomplete = findAttribute(node, ['autoComplete', 'autocomplete']);
        if (autocomplete !== undefined && !isEmptyAutocomplete(autocomplete)) {
          return;
        }
        context.report({ node: typeAttribute, messageId: 'missingAutocomplete' });
      },
    };
  },
});
