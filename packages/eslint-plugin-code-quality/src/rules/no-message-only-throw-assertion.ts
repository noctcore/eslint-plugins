import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';

const RULE_NAME = 'no-message-only-throw-assertion';

export interface NoMessageOnlyThrowAssertionOptions {
  /** Matchers that assert a throw or a rejection (`toThrow`, `toThrowError`). */
  readonly throwMatchers?: readonly string[];
  /**
   * Report only the argless form (`toThrow()`), and accept a string or regex
   * argument. For adopting the rule in two steps.
   */
  readonly allowMessageOnly?: boolean;
  /**
   * Treat an error instance argument (`toThrow(new NotFoundError('x'))`) as
   * pinning the class. True for Vitest, which compares the instance like
   * `toEqual`; set false under Jest, which compares only the message.
   */
  readonly trustErrorInstances?: boolean;
  /**
   * Regex sources (compiled with the `u` flag) for assertion helpers that pin
   * the error class, such as `expectRejectsDomainError(promise, {...})`. A
   * message-only assertion is accepted when a matching helper is called on the
   * same subject in the same test. Matched against `name` for a bare call and
   * `obj.name` for a member call on an identifier.
   */
  readonly assertionHelpers?: readonly string[];
}

type RuleOptions = [NoMessageOnlyThrowAssertionOptions];
type MessageIds = 'bareThrow' | 'messageOnlyThrow';

const DEFAULT_THROW_MATCHERS: readonly string[] = ['toThrow', 'toThrowError'];
const DEFAULT_ALLOW_MESSAGE_ONLY = false;
const DEFAULT_TRUST_ERROR_INSTANCES = true;
const DEFAULT_ASSERTION_HELPERS: readonly string[] = [];

/** Matchers on a `.rejects` chain that pin the rejection beyond its message. */
const REJECTS_PINNING_MATCHERS = new Set([
  'toBeInstanceOf',
  'toMatchObject',
  'toEqual',
  'toStrictEqual',
  'toHaveProperty',
]);

const TEST_RUNNERS = new Set(['it', 'test']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    throwMatchers: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
      minItems: 1,
    },
    allowMessageOnly: { type: 'boolean' },
    trustErrorInstances: { type: 'boolean' },
    assertionHelpers: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      uniqueItems: true,
    },
  },
};

type FunctionNode = TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;

interface MatcherChain {
  /** The `expect(...)` call at the root of the chain. */
  readonly root: TSESTree.CallExpression;
  readonly matcher: string;
  readonly negated: boolean;
  readonly rejects: boolean;
}

interface Finding {
  readonly node: TSESTree.CallExpression;
  readonly messageId: MessageIds;
  readonly matcher: string;
  readonly subject: string;
  /** The block the assertion runs in. */
  readonly block: TSESTree.Node;
}

interface TestFrame {
  readonly node: FunctionNode | null;
  readonly findings: Finding[];
  /** Source text of every subject whose error class is pinned in this test, to the blocks that pin it. */
  readonly pinned: Map<string, TSESTree.Node[]>;
}

/** The nearest enclosing block: a block statement, a function (expression body) or the program. */
function enclosingBlock(node: TSESTree.Node): TSESTree.Node {
  let current: TSESTree.Node = node;
  // `parent` is null on the Program node at runtime, whatever the types say.
  while (current.parent) {
    current = current.parent;
    if (
      current.type === AST_NODE_TYPES.BlockStatement ||
      current.type === AST_NODE_TYPES.ArrowFunctionExpression ||
      current.type === AST_NODE_TYPES.FunctionExpression
    ) {
      return current;
    }
  }
  return current;
}

/** True when `ancestor` is `node` or contains it. */
function isSelfOrAncestor(ancestor: TSESTree.Node, node: TSESTree.Node): boolean {
  for (let current: TSESTree.Node | undefined = node; current; current = current.parent) {
    if (current === ancestor) {
      return true;
    }
  }
  return false;
}

/** Decompose `expect(x).rejects.not.toThrow(y)` into its parts, or null. */
function matcherChain(node: TSESTree.CallExpression): MatcherChain | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  let negated = false;
  let rejects = false;
  let current: TSESTree.Expression = callee.object;
  while (current.type === AST_NODE_TYPES.MemberExpression) {
    if (!current.computed && current.property.type === AST_NODE_TYPES.Identifier) {
      if (current.property.name === 'not') {
        negated = !negated;
      } else if (current.property.name === 'rejects') {
        rejects = true;
      }
    }
    current = current.object;
  }
  if (
    current.type !== AST_NODE_TYPES.CallExpression ||
    current.callee.type !== AST_NODE_TYPES.Identifier ||
    current.callee.name !== 'expect'
  ) {
    return null;
  }
  return { root: current, matcher: callee.property.name, negated, rejects };
}

/** `name` or `obj.name` for a callee, used to match `assertionHelpers`. */
function calleePath(callee: TSESTree.Expression): string | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return callee.name;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    const owner = callee.object.type === AST_NODE_TYPES.Identifier ? callee.object.name : '';
    return `${owner}.${callee.property.name}`;
  }
  return null;
}

/** Root identifier of a test callee: `it`, `test.concurrent`, `it.each(table)`. */
function runnerName(callee: TSESTree.Node): string | null {
  let current: TSESTree.Node = callee;
  for (;;) {
    if (current.type === AST_NODE_TYPES.MemberExpression) {
      current = current.object;
    } else if (current.type === AST_NODE_TYPES.CallExpression) {
      current = current.callee;
    } else if (current.type === AST_NODE_TYPES.TaggedTemplateExpression) {
      current = current.tag;
    } else {
      break;
    }
  }
  return current.type === AST_NODE_TYPES.Identifier ? current.name : null;
}

function isTestCallback(node: FunctionNode): boolean {
  const parent = node.parent;
  if (parent.type !== AST_NODE_TYPES.CallExpression || !parent.arguments.includes(node)) {
    return false;
  }
  const name = runnerName(parent.callee);
  return name !== null && TEST_RUNNERS.has(name);
}

/** True for `new RegExp(...)` / `RegExp(...)`: a pattern, so a message check. */
function isRegExpConstruction(node: TSESTree.Node): boolean {
  return (
    (node.type === AST_NODE_TYPES.NewExpression || node.type === AST_NODE_TYPES.CallExpression) &&
    node.callee.type === AST_NODE_TYPES.Identifier &&
    node.callee.name === 'RegExp'
  );
}

/** True for an argument that checks only the message: a string, a template or a regex. */
function isMessageArgument(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string' || 'regex' in node;
  }
  return node.type === AST_NODE_TYPES.TemplateLiteral || isRegExpConstruction(node);
}

export const noMessageOnlyThrowAssertionRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `toThrow()` with no argument or with only a message: any error passes, including a `TypeError` from a broken mock. Pin the error class.',
    },
    schema: [optionSchema],
    messages: {
      bareThrow:
        '`{{matcher}}()` with no argument passes for any error, including a `TypeError` from a broken mock. Pass the error class, or assert the error with `.rejects.toMatchObject(...)`.',
      messageOnlyThrow:
        '`{{matcher}}(...)` with only a message passes for any error class with that wording. Pass the error class, or pin it with a second assertion on the same subject.',
    },
  },
  defaultOptions: [
    {
      throwMatchers: [...DEFAULT_THROW_MATCHERS],
      allowMessageOnly: DEFAULT_ALLOW_MESSAGE_ONLY,
      trustErrorInstances: DEFAULT_TRUST_ERROR_INSTANCES,
      assertionHelpers: [...DEFAULT_ASSERTION_HELPERS],
    },
  ],
  create(context, [options]) {
    const throwMatchers = new Set(options.throwMatchers ?? DEFAULT_THROW_MATCHERS);
    const allowMessageOnly = options.allowMessageOnly ?? DEFAULT_ALLOW_MESSAGE_ONLY;
    const trustErrorInstances = options.trustErrorInstances ?? DEFAULT_TRUST_ERROR_INSTANCES;
    const assertionHelpers = (options.assertionHelpers ?? DEFAULT_ASSERTION_HELPERS).map(
      (source) => new RegExp(source, 'u'),
    );
    const stack: TestFrame[] = [{ node: null, findings: [], pinned: new Map() }];

    function textOf(node: TSESTree.Node | undefined): string | null {
      return node === undefined ? null : context.sourceCode.getText(node);
    }

    /**
     * True when the frame pins `finding`'s subject in the finding's block or an
     * enclosing one, so the pin runs whenever the message check does. A bare
     * throw is never excused: a later call on the same subject is often a
     * different scenario, and any error satisfies it.
     */
    function isPaired(frame: TestFrame, finding: Finding): boolean {
      if (finding.messageId === 'bareThrow') {
        return false;
      }
      const blocks = frame.pinned.get(finding.subject) ?? [];
      return blocks.some((block) => isSelfOrAncestor(block, finding.block));
    }

    function pin(frame: TestFrame, subject: string, node: TSESTree.Node): void {
      const blocks = frame.pinned.get(subject) ?? [];
      blocks.push(enclosingBlock(node));
      frame.pinned.set(subject, blocks);
    }

    /** Report what the frame holds, minus message checks the same test pairs with a class pin. */
    function flush(frame: TestFrame): void {
      for (const finding of frame.findings) {
        if (isPaired(frame, finding)) {
          continue;
        }
        context.report({
          node: finding.node,
          messageId: finding.messageId,
          data: { matcher: finding.matcher },
        });
      }
    }

    function enter(node: FunctionNode): void {
      if (isTestCallback(node)) {
        stack.push({ node, findings: [], pinned: new Map() });
      }
    }

    function exit(node: FunctionNode): void {
      const frame = stack.at(-1);
      if (frame?.node === node) {
        stack.pop();
        flush(frame);
      }
    }

    /** Classify a throw matcher's argument: null when it pins the class. */
    function classify(argument: TSESTree.Node | undefined): MessageIds | null {
      if (argument === undefined) {
        return 'bareThrow';
      }
      if (isMessageArgument(argument)) {
        return allowMessageOnly ? null : 'messageOnlyThrow';
      }
      if (argument.type === AST_NODE_TYPES.NewExpression && !trustErrorInstances) {
        return allowMessageOnly ? null : 'messageOnlyThrow';
      }
      return null;
    }

    return {
      ArrowFunctionExpression: enter,
      FunctionExpression: enter,
      'ArrowFunctionExpression:exit': exit,
      'FunctionExpression:exit': exit,
      CallExpression(node: TSESTree.CallExpression): void {
        const frame = stack.at(-1);
        if (frame === undefined) {
          return;
        }
        const chain = matcherChain(node);
        if (chain === null) {
          const path = calleePath(node.callee);
          const subject = textOf(node.arguments[0]);
          if (path !== null && subject !== null && assertionHelpers.some((re) => re.test(path))) {
            pin(frame, subject, node);
          }
          return;
        }
        const subject = textOf(chain.root.arguments[0]);
        if (chain.negated || subject === null) {
          return;
        }
        if (throwMatchers.has(chain.matcher)) {
          const messageId = classify(node.arguments[0]);
          if (messageId === null) {
            pin(frame, subject, node);
          } else {
            const block = enclosingBlock(node);
            frame.findings.push({ node, messageId, matcher: chain.matcher, subject, block });
          }
        } else if (chain.rejects && REJECTS_PINNING_MATCHERS.has(chain.matcher)) {
          pin(frame, subject, node);
        }
      },
      'Program:exit'(): void {
        const root = stack[0];
        if (root !== undefined) {
          flush(root);
        }
      },
    };
  },
});
