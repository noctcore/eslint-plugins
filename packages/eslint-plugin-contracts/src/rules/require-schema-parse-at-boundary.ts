import { AST_NODE_TYPES, ASTUtils, type TSESLint, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'require-schema-parse-at-boundary';

export interface RequireSchemaParseAtBoundaryOptions {
  /**
   * Extra callees whose result is boundary data: a bare name (`readBody`) or a
   * dotted path (`ipcRenderer.invoke`). `readBody(event) as T` and
   * `(await readBody(event)) as T` are then flagged like `JSON.parse`. Default `[]`.
   */
  readonly boundaries?: readonly string[];
}

type RuleOptions = [RequireSchemaParseAtBoundaryOptions];
type MessageIds = 'castedBoundaryData';

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    boundaries: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
    },
  },
};

/*
 * External data crossing a trust boundary must be PARSED at runtime (zod /
 * valibot), not merely asserted with `as T`. A cast is a compile-time promise
 * TypeScript never checks — a shape change on the wire slips straight through and
 * corrupts state far from the boundary.
 *
 * A fully general form of this rule needs type information (to know an arbitrary
 * value originated at a boundary). The shared tester is NOT type-aware, so this
 * ships a CONSERVATIVE SYNTACTIC slice. A cast is flagged when its target is a
 * shape claim (`as User`, `as User[]`, `as User | null`) and its operand is a
 * boundary read:
 *   - `JSON.parse(...)` (so `localStorage.getItem` and OpenAI tool-call
 *     `x.function.arguments` fed to it are covered too)
 *   - `await <expr>.json()`
 *   - `localStorage.getItem(...)` / `sessionStorage.getItem(...)`
 *   - `new URLSearchParams(...).get(...)` / `<x>.searchParams.get(...)`
 *   - `event.data` where `event` is the parameter of a `message` listener
 *   - `block.input` where `block` is proven an Anthropic `tool_use` block
 *   - a call to a configured `boundaries` callee
 * or a same-function, single-assignment `const` bound to one of those. The
 * binding is followed only when nothing could have validated it first: any
 * other read of it before the cast (a guard call, an `in` check, passing it
 * elsewhere) or any read from a nested function makes the rule stay silent.
 * Casts to `unknown`, `any`, `const` or a primitive keyword are the safe or
 * neutral forms and are never flagged.
 */

/** Child-to-parent step; ESLint 10 sets `Program.parent` to null, typings say absent. */
function parentOf(node: TSESTree.Node): TSESTree.Node | null {
  return node.parent ?? null;
}

/** Dotted path of a plain callee or receiver (`fetch`, `window.localStorage`), or null. */
function memberPath(node: TSESTree.Node): string | null {
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name;
  }
  if (
    node.type === AST_NODE_TYPES.MemberExpression &&
    !node.computed &&
    node.property.type === AST_NODE_TYPES.Identifier
  ) {
    const object = memberPath(node.object);
    return object === null ? null : `${object}.${node.property.name}`;
  }
  return null;
}

/** `<object>.<name>(...)` with a non-computed property; returns the object. */
function methodCallReceiver(node: TSESTree.Node, names: readonly string[]): TSESTree.Node | null {
  if (
    node.type === AST_NODE_TYPES.CallExpression &&
    node.callee.type === AST_NODE_TYPES.MemberExpression &&
    !node.callee.computed &&
    node.callee.property.type === AST_NODE_TYPES.Identifier &&
    names.includes(node.callee.property.name)
  ) {
    return node.callee.object;
  }
  return null;
}

/** Strips `!`, `?.` chains and nothing else; parentheses are not nodes. */
function unwrap(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  while (
    current.type === AST_NODE_TYPES.TSNonNullExpression ||
    current.type === AST_NODE_TYPES.ChainExpression
  ) {
    current = current.expression;
  }
  return current;
}

/** `JSON.parse(...)` call. */
function isJsonParseCall(node: TSESTree.Node): boolean {
  return (
    node.type === AST_NODE_TYPES.CallExpression && memberPath(node.callee) === 'JSON.parse'
  );
}

/** `await <anything>.json()` — the canonical fetch/Response body read. */
function isAwaitJsonCall(node: TSESTree.Node): boolean {
  if (node.type !== AST_NODE_TYPES.AwaitExpression) {
    return false;
  }
  const call = node.argument;
  return (
    methodCallReceiver(call, ['json']) !== null &&
    call.type === AST_NODE_TYPES.CallExpression &&
    call.arguments.length === 0
  );
}

/** `localStorage.getItem(...)`, `window.sessionStorage.getItem(...)`. */
function isStorageRead(node: TSESTree.Node): boolean {
  const receiver = methodCallReceiver(node, ['getItem']);
  const path = receiver === null ? null : memberPath(receiver);
  if (path === null) {
    return false;
  }
  const last = path.slice(path.lastIndexOf('.') + 1);
  return last === 'localStorage' || last === 'sessionStorage';
}

type Variable = TSESLint.Scope.Variable;

class BoundaryMatcher {
  private readonly sourceCode: Readonly<TSESLint.SourceCode>;
  private readonly boundaries: ReadonlySet<string>;

  constructor(sourceCode: Readonly<TSESLint.SourceCode>, boundaries: readonly string[]) {
    this.sourceCode = sourceCode;
    this.boundaries = new Set(boundaries);
  }

  /** True when `expr`, the operand of the cast at `cast`, is boundary data. */
  isBoundary(expr: TSESTree.Node, cast: TSESTree.Node, seen: Set<Variable>): boolean {
    const node = unwrap(expr);
    if (
      isJsonParseCall(node) ||
      isAwaitJsonCall(node) ||
      isStorageRead(node) ||
      this.isSearchParamsRead(node) ||
      this.isConfiguredBoundary(node) ||
      this.isMessageEventData(node) ||
      this.isToolUseInput(node)
    ) {
      return true;
    }
    if (node.type !== AST_NODE_TYPES.Identifier) {
      return false;
    }
    const variable = this.resolve(node);
    if (variable === null || seen.has(variable)) {
      return false;
    }
    seen.add(variable);
    const init = this.constInit(variable);
    return (
      init !== null &&
      this.untouchedBefore(variable, node, cast) &&
      this.isBoundary(init, init, seen)
    );
  }

  private resolve(identifier: TSESTree.Identifier): Variable | null {
    return ASTUtils.findVariable(this.sourceCode.getScope(identifier), identifier) ?? null;
  }

  /** The initializer of a single `const name = <init>` declaration, or null. */
  private constInit(variable: Variable): TSESTree.Expression | null {
    const [def] = variable.defs;
    if (variable.defs.length !== 1 || def === undefined) {
      return null;
    }
    const declarator = def.node;
    if (
      declarator.type !== AST_NODE_TYPES.VariableDeclarator ||
      declarator.id.type !== AST_NODE_TYPES.Identifier ||
      declarator.init === null
    ) {
      return null;
    }
    const declaration = parentOf(declarator);
    if (
      declaration?.type !== AST_NODE_TYPES.VariableDeclaration ||
      declaration.kind !== 'const'
    ) {
      return null;
    }
    return declarator.init;
  }

  /**
   * True when the only reads of `variable` that could run before `cast` are the
   * `use` itself and other `as` casts, all in the declaring function. Any other
   * earlier read (a guard, a validator call, a mutation) might have checked the
   * value, so the cast is given the benefit of the doubt.
   */
  private untouchedBefore(variable: Variable, use: TSESTree.Identifier, cast: TSESTree.Node): boolean {
    const home = variable.scope.variableScope;
    return variable.references.every((reference) => {
      if (reference.init === true) {
        return true;
      }
      if (reference.from.variableScope !== home) {
        return false;
      }
      const id = reference.identifier;
      if (id === use || id.range[0] >= cast.range[0]) {
        return true;
      }
      return parentOf(id)?.type === AST_NODE_TYPES.TSAsExpression;
    });
  }

  /** A call whose callee is listed in the `boundaries` option. */
  private isConfiguredBoundary(node: TSESTree.Node): boolean {
    if (this.boundaries.size === 0) {
      return false;
    }
    const call =
      node.type === AST_NODE_TYPES.AwaitExpression ? unwrap(node.argument) : node;
    if (call.type !== AST_NODE_TYPES.CallExpression) {
      return false;
    }
    const path = memberPath(call.callee);
    return path !== null && this.boundaries.has(path);
  }

  /** `.get(...)` / `.getAll(...)` on a `URLSearchParams`. */
  private isSearchParamsRead(node: TSESTree.Node): boolean {
    const receiver = methodCallReceiver(node, ['get', 'getAll']);
    return receiver !== null && this.isSearchParams(unwrap(receiver), new Set());
  }

  private isSearchParams(node: TSESTree.Node, seen: Set<Variable>): boolean {
    if (node.type === AST_NODE_TYPES.NewExpression) {
      return node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'URLSearchParams';
    }
    if (node.type === AST_NODE_TYPES.MemberExpression) {
      return (
        !node.computed &&
        node.property.type === AST_NODE_TYPES.Identifier &&
        node.property.name === 'searchParams'
      );
    }
    if (node.type !== AST_NODE_TYPES.Identifier) {
      return false;
    }
    if (node.name === 'searchParams') {
      return true;
    }
    const variable = this.resolve(node);
    if (variable === null || seen.has(variable)) {
      return false;
    }
    seen.add(variable);
    const init = this.constInit(variable);
    return init !== null && this.isSearchParams(unwrap(init), seen);
  }

  /** `event.data` (or a `{ data }` destructured parameter) in a `message` listener. */
  private isMessageEventData(node: TSESTree.Node): boolean {
    let identifier: TSESTree.Identifier;
    if (node.type === AST_NODE_TYPES.MemberExpression) {
      if (
        node.computed ||
        node.property.type !== AST_NODE_TYPES.Identifier ||
        node.property.name !== 'data' ||
        node.object.type !== AST_NODE_TYPES.Identifier
      ) {
        return false;
      }
      identifier = node.object;
    } else if (node.type === AST_NODE_TYPES.Identifier) {
      identifier = node;
    } else {
      return false;
    }
    const variable = this.resolve(identifier);
    const param = variable === null ? null : parameterOf(variable);
    if (param === null) {
      return false;
    }
    const { fn, name } = param;
    const [first] = fn.params;
    if (first === undefined) {
      return false;
    }
    const isParamItself = name === first;
    const isDestructuredData =
      first.type === AST_NODE_TYPES.ObjectPattern &&
      first.properties.some(
        (property) =>
          property.type === AST_NODE_TYPES.Property &&
          !property.computed &&
          property.key.type === AST_NODE_TYPES.Identifier &&
          property.key.name === 'data' &&
          property.value === name,
      );
    if (node.type === AST_NODE_TYPES.MemberExpression ? !isParamItself : !isDestructuredData) {
      return false;
    }
    return isMessageListener(fn);
  }

  /** `block.input` where `block` is narrowed to an Anthropic `tool_use` content block. */
  private isToolUseInput(node: TSESTree.Node): boolean {
    if (
      node.type !== AST_NODE_TYPES.MemberExpression ||
      node.computed ||
      node.property.type !== AST_NODE_TYPES.Identifier ||
      node.property.name !== 'input'
    ) {
      return false;
    }
    const block = unwrap(node.object);
    const blockText = this.sourceCode.getText(block);
    if (this.isGuardedAsToolUse(node, blockText)) {
      return true;
    }
    if (block.type !== AST_NODE_TYPES.Identifier) {
      return false;
    }
    const variable = this.resolve(block);
    if (variable === null) {
      return false;
    }
    // `const block = content.find((b) => b.type === 'tool_use')`
    const init = this.constInit(variable);
    if (init !== null) {
      const receiver = methodCallReceiver(unwrap(init), ['find']);
      const call = unwrap(init);
      return (
        receiver !== null &&
        call.type === AST_NODE_TYPES.CallExpression &&
        this.isToolUsePredicate(call.arguments[0])
      );
    }
    // `content.filter((b) => b.type === 'tool_use').map((block) => block.input)`
    const param = parameterOf(variable);
    if (param !== null && param.fn.params[0] === param.name) {
      const call = parentOf(param.fn);
      if (
        call?.type !== AST_NODE_TYPES.CallExpression ||
        call.arguments[0] !== param.fn ||
        methodCallReceiver(call, ['map', 'flatMap', 'forEach']) === null
      ) {
        return false;
      }
      const filtered = unwrap((call.callee as TSESTree.MemberExpression).object);
      return (
        methodCallReceiver(filtered, ['filter']) !== null &&
        filtered.type === AST_NODE_TYPES.CallExpression &&
        this.isToolUsePredicate(filtered.arguments[0])
      );
    }
    return false;
  }

  /** `(b) => b.type === 'tool_use'`, optionally with a type-predicate return. */
  private isToolUsePredicate(node: TSESTree.Node | undefined): boolean {
    if (
      node?.type !== AST_NODE_TYPES.ArrowFunctionExpression ||
      node.body.type === AST_NODE_TYPES.BlockStatement
    ) {
      return false;
    }
    const [param] = node.params;
    return (
      param?.type === AST_NODE_TYPES.Identifier &&
      this.testProvesToolUse(node.body, param.name)
    );
  }

  /** An enclosing `if` / `?:` / `&&` / `case 'tool_use':` narrows `blockText`. */
  private isGuardedAsToolUse(from: TSESTree.Node, blockText: string): boolean {
    let child = from;
    for (let parent = parentOf(child); parent !== null; child = parent, parent = parentOf(child)) {
      switch (parent.type) {
        case AST_NODE_TYPES.IfStatement:
        case AST_NODE_TYPES.ConditionalExpression:
          if (parent.consequent === child && this.testProvesToolUse(parent.test, blockText)) {
            return true;
          }
          break;
        case AST_NODE_TYPES.LogicalExpression:
          if (
            parent.operator === '&&' &&
            parent.right === child &&
            this.testProvesToolUse(parent.left, blockText)
          ) {
            return true;
          }
          break;
        case AST_NODE_TYPES.SwitchCase: {
          const statement = parentOf(parent);
          if (
            parent.test?.type === AST_NODE_TYPES.Literal &&
            parent.test.value === 'tool_use' &&
            statement?.type === AST_NODE_TYPES.SwitchStatement &&
            this.sourceCode.getText(statement.discriminant) === `${blockText}.type`
          ) {
            return true;
          }
          break;
        }
        default:
          break;
      }
    }
    return false;
  }

  /** `<blockText>.type === 'tool_use'`, possibly one conjunct of an `&&` chain. */
  private testProvesToolUse(test: TSESTree.Node, blockText: string): boolean {
    if (test.type === AST_NODE_TYPES.LogicalExpression && test.operator === '&&') {
      return (
        this.testProvesToolUse(test.left, blockText) ||
        this.testProvesToolUse(test.right, blockText)
      );
    }
    if (
      test.type !== AST_NODE_TYPES.BinaryExpression ||
      (test.operator !== '===' && test.operator !== '==')
    ) {
      return false;
    }
    const typeText = `${blockText}.type`;
    const isToolUse = (node: TSESTree.Node): boolean =>
      node.type === AST_NODE_TYPES.Literal && node.value === 'tool_use';
    const isTypeRead = (node: TSESTree.Node): boolean =>
      this.sourceCode.getText(unwrap(node)) === typeText ||
      this.sourceCode.getText(node) === `${blockText}?.type`;
    return (
      (isTypeRead(test.left) && isToolUse(test.right)) ||
      (isToolUse(test.left) && isTypeRead(test.right))
    );
  }
}

type FunctionLike =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression;

/** The function a parameter binding belongs to, and its binding identifier. */
function parameterOf(variable: Variable): { fn: FunctionLike; name: TSESTree.Node } | null {
  const [def] = variable.defs;
  if (variable.defs.length !== 1 || def === undefined || def.type !== 'Parameter') {
    return null;
  }
  const fn = def.node;
  if (
    fn.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
    fn.type !== AST_NODE_TYPES.FunctionDeclaration &&
    fn.type !== AST_NODE_TYPES.FunctionExpression
  ) {
    return null;
  }
  return { fn, name: def.name };
}

/** `x.addEventListener('message', fn)`, `x.onmessage = fn` or `onmessage = fn`. */
function isMessageListener(fn: TSESTree.Node): boolean {
  const parent = parentOf(fn);
  if (parent?.type === AST_NODE_TYPES.CallExpression) {
    const [event, listener] = parent.arguments;
    const callee = memberPath(parent.callee);
    return (
      listener === fn &&
      event?.type === AST_NODE_TYPES.Literal &&
      event.value === 'message' &&
      callee !== null &&
      (callee === 'addEventListener' || callee.endsWith('.addEventListener'))
    );
  }
  if (parent?.type === AST_NODE_TYPES.AssignmentExpression && parent.right === fn) {
    const target = memberPath(parent.left);
    return target !== null && (target === 'onmessage' || target.endsWith('.onmessage'));
  }
  return false;
}

/**
 * True when the cast target is a shape claim (a named type reference other than
 * `const`, an array type, or a union / intersection with one such member).
 * `as unknown` / `as any` / `as const` and bare primitive keywords are the safe
 * forms and return false.
 */
function isShapeClaim(annotation: TSESTree.TypeNode): boolean {
  if (annotation.type === AST_NODE_TYPES.TSArrayType) {
    return true;
  }
  if (
    annotation.type === AST_NODE_TYPES.TSUnionType ||
    annotation.type === AST_NODE_TYPES.TSIntersectionType
  ) {
    return annotation.types.some(isShapeClaim);
  }
  if (annotation.type === AST_NODE_TYPES.TSTypeReference) {
    return !(
      annotation.typeName.type === AST_NODE_TYPES.Identifier &&
      annotation.typeName.name === 'const'
    );
  }
  return false;
}

export const requireSchemaParseAtBoundaryRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow asserting external boundary data with `as T` instead of parsing it at runtime. Flags casts of `JSON.parse`, `res.json()`, web storage, URL search params, message-event data and LLM tool input, directly or through a `const`; use a zod/valibot parse.',
    },
    schema: [optionSchema],
    messages: {
      castedBoundaryData:
        'Boundary data is asserted with `as` here, not parsed. A cast is unchecked — validate this with a runtime schema (e.g. `Schema.parse(...)`) so a wire-shape change fails loudly.',
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const matcher = new BoundaryMatcher(context.sourceCode, options.boundaries ?? []);
    return {
      TSAsExpression(node): void {
        if (!isShapeClaim(node.typeAnnotation)) {
          return;
        }
        if (matcher.isBoundary(node.expression, node, new Set())) {
          context.report({ node, messageId: 'castedBoundaryData' });
        }
      },
    };
  },
});
