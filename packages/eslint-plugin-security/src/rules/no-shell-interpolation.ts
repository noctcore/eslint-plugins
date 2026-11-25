import {
  AST_NODE_TYPES,
  unwrapTypeWrappers,
  type TSESLint,
  type TSESTree,
} from '@noctcore/eslint-utils';
import { ASTUtils } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { type GuardContext, isProvenSafeValue, peelStringWrappers } from '../guards';
import { classifyShellParts, commandName, type ShellPart } from '../shell-words';
import { callArguments, conventionalCallee, flowSteps, stringPieces } from '../value-flow';

const RULE_NAME = 'no-shell-interpolation';

export interface NoShellInterpolationOptions {
  readonly extraCallees?: readonly string[];
  /** Treat values read from `process.env` with a fixed key as the operator's, not the requester's. */
  readonly trustEnvironment?: boolean;
}

type RuleOptions = [NoShellInterpolationOptions];
type MessageIds = 'shellInterpolation';

/*
 * Command-injection precision. A dynamically-built command string flowing into a
 * shell runner is the classic injection sink: `exec(`git checkout ${branch}`)`
 * lets a crafted `branch` run arbitrary commands. The fix is to pass the program
 * and its arguments separately (`execFile('git', ['checkout', branch])`), where
 * the OS never re-parses a shell string.
 *
 * PRECISION IS THE POINT — this rule fires ONLY on the genuinely dangerous shape:
 *  - `exec` / `execSync` (always shell): first arg is a template literal with
 *    expressions, or a `+` concatenation with a dynamic part.
 *  - `spawn` / `spawnSync` / `execFile` / `execFileSync`: same dynamic first arg,
 *    but ONLY when an options object literal passes a `shell` value other than
 *    `false` (`true`, a shell path, or a runtime value such as
 *    `process.platform === 'win32'`, which is a shell on some machines). With
 *    a shell, Node joins the args array into the command, so its elements are
 *    read as command text too. Without a shell option, a program that is
 *    itself a shell told to run a command (`spawn('sh', ['-c', cmd])`,
 *    `cmd /c`) has that command checked like `exec`. The other array-args,
 *    no-shell forms are safe and left entirely alone.
 *  - A binding made with `promisify(exec)` (or `util.promisify(cp.exec)`) is
 *    followed through scope and checked like the runner it wraps.
 *  - A runtime part the function already proved harmless is accepted (see
 *    `../guards`): checked before the call against an allowlist of literals
 *    or a shell-inert anchored regex, the output of a schema with such a
 *    pattern, an in-file `const` literal, or a value read from `process.env`.
 * `exec` called as a member on a non-`child_process` object (notably
 * `regex.exec(...)`) is excluded so RegExp usage never false-positives. There is
 * no autofix — the safe rewrite changes the call shape.
 */
const ALWAYS_SHELL: ReadonlySet<string> = new Set(['exec', 'execSync']);
const CONDITIONAL_SHELL: ReadonlySet<string> = new Set([
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
]);
/** Object names that identify a `child_process` import for the `exec` member form. */
const CHILD_PROCESS_OBJECT = /^(cp|childprocess|child_process)$/i;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    extraCallees: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Extra callee names to treat as always-shell command runners, checked like `exec`.',
    },
    trustEnvironment: {
      type: 'boolean',
      description:
        'Leave values read from `process.env` with a fixed key alone, as set by the operator. Off by default: in CI, variables such as `GITHUB_HEAD_REF` hold text an outsider chose.',
    },
  },
};

interface CalleeInfo {
  readonly name: string;
  readonly isMember: boolean;
  readonly objectName: string | undefined;
}

/**
 * {@link getCalleeInfo} with imports read under their usual names:
 * `run` for `import { exec as run }` is `exec`, `shell.exec` for
 * `const shell = require('child_process')` is `child_process.exec`.
 */
function resolvedCalleeInfo(
  callee: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): CalleeInfo | null {
  const text = conventionalCallee(callee, sourceCode);
  if (text === null) {
    return getCalleeInfo(callee);
  }
  const parts = text.split('.');
  const name = parts.at(-1) as string;
  return parts.length === 1
    ? { name, isMember: false, objectName: undefined }
    : { name, isMember: true, objectName: parts.length === 2 ? parts[0] : undefined };
}

function getCalleeInfo(callee: TSESTree.Node): CalleeInfo | null {
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return { name: callee.name, isMember: false, objectName: undefined };
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    const objectName =
      callee.object.type === AST_NODE_TYPES.Identifier ? callee.object.name : undefined;
    return { name: callee.property.name, isMember: true, objectName };
  }
  return null;
}

/** True when a `+` tree contains at least one non-literal (dynamic) operand. */
function concatHasDynamicPart(node: TSESTree.Node): boolean {
  if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
    return concatHasDynamicPart(node.left) || concatHasDynamicPart(node.right);
  }
  return node.type !== AST_NODE_TYPES.Literal;
}

/** True when `node` builds a command string from dynamic parts at this call site. */
function isDynamicCommandString(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  // `'git log '.concat(x)` and `['git log ', x].join('')` build it by method.
  const pieces = stringPieces(node, sourceCode);
  if (pieces !== null) {
    return pieces.some(
      (piece) =>
        typeof piece !== 'string' &&
        piece.type !== AST_NODE_TYPES.Literal &&
        !(piece.type === AST_NODE_TYPES.TemplateLiteral && piece.expressions.length === 0),
    );
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    return node.expressions.length > 0;
  }
  if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
    return concatHasDynamicPart(node);
  }
  return false;
}

/** How deep `const` string bindings are followed when the command is read. */
const MAX_CONST_DEPTH = 8;

/**
 * The static text and runtime values of a command string, in order. An
 * in-file `const` bound to a string literal (or to a template or `+` of such
 * parts) is read as the text it holds, so `const P = 'sudo'` or
 * `const SEP = ';'` changes where the next value lands. Wrappers that keep
 * the text (`String(x)`, `as`, `satisfies`, `!`) are read through.
 */
function commandSegments(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): (string | TSESTree.Node)[] {
  const segments: (string | TSESTree.Node)[] = [];
  const collect = (raw: TSESTree.Node, depth: number): void => {
    const part = peelStringWrappers(raw, sourceCode);
    const pieces = stringPieces(part, sourceCode);
    if (pieces !== null) {
      for (const piece of pieces) {
        if (typeof piece === 'string') {
          segments.push(piece);
        } else {
          collect(piece, depth);
        }
      }
    } else if (part.type === AST_NODE_TYPES.TemplateLiteral) {
      part.quasis.forEach((quasi, index) => {
        segments.push(quasi.value.cooked ?? '');
        const expression = part.expressions[index];
        if (expression !== undefined) {
          collect(expression, depth + 1);
        }
      });
    } else if (part.type === AST_NODE_TYPES.BinaryExpression && part.operator === '+') {
      collect(part.left, depth);
      collect(part.right, depth);
    } else if (part.type === AST_NODE_TYPES.Literal) {
      segments.push(String(part.value));
    } else {
      const init = depth < MAX_CONST_DEPTH ? constStringInit(part, sourceCode) : null;
      if (init === null) {
        segments.push(part);
      } else {
        collect(init, depth + 1);
      }
    }
  };
  collect(node, 0);
  return segments;
}

/**
 * For an identifier bound once by an in-file `const` to a string literal, a
 * template, a `+` or a string built by method (whose own parts are read the
 * same way), that initializer; else null.
 */
function constStringInit(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): TSESTree.Node | null {
  const inner = unwrapTypeWrappers(node);
  if (inner.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(inner), inner);
  const def = variable?.defs[0];
  if (
    variable?.defs.length !== 1 ||
    def?.type !== 'Variable' ||
    def.parent.kind !== 'const' ||
    def.node.id.type !== AST_NODE_TYPES.Identifier ||
    def.node.init === null
  ) {
    return null;
  }
  const init = peelStringWrappers(def.node.init, sourceCode);
  const textual =
    (init.type === AST_NODE_TYPES.Literal && typeof init.value === 'string') ||
    init.type === AST_NODE_TYPES.TemplateLiteral ||
    (init.type === AST_NODE_TYPES.BinaryExpression && init.operator === '+') ||
    init.type === AST_NODE_TYPES.Identifier ||
    stringPieces(init, sourceCode) !== null;
  return textual ? init : null;
}

/**
 * The guard contexts a runtime part must be proven in, from where it lands in
 * the command. A value glued after another value may start the word (when
 * that one is empty) or follow a `/` it ends with, so it needs both.
 */
function partContexts(part: ShellPart): GuardContext[] {
  if (part.commandWord) {
    return ['command'];
  }
  if (part.afterSlash) {
    return ['shell-path'];
  }
  if (part.afterValue) {
    return ['shell', 'shell-path'];
  }
  return [part.midWord ? 'shell-word' : 'shell'];
}

/** The most readings of one command tried (see {@link commandReadings}). */
const MAX_READINGS = 64;

type Segments = readonly (string | TSESTree.Node)[];

/**
 * The texts a value can hold when it is proven by literals alone (an
 * allowlist, a compared string, a constant), else null.
 */
function literalTexts(
  node: TSESTree.Node,
  sink: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string[] | null {
  const texts = new Set<string>();
  const proven = isProvenSafeValue(node, sink, 'command', sourceCode, {
    onLiteral: (text) => texts.add(text),
  });
  return proven && texts.size > 0 ? [...texts] : null;
}

/**
 * Every way the command can read. A value proven by literals is read as each
 * text it can hold (`A${e}1` with `e === '='` is an assignment, `${p}` with
 * `p` in `['sudo', 'ls']` may be a wrapper), and every reading must hold. A
 * value proven some other way that a program name needs (a value from
 * `process.env` under `trustEnvironment`), or one with more texts than
 * {@link MAX_READINGS} allows, is opaque: its text is not known.
 */
function commandReadings(
  segments: Segments,
  sink: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
  trustEnvironment: boolean,
): { readonly segments: Segments; readonly opaque: ReadonlySet<TSESTree.Node> }[] {
  const choices = segments.map((segment) =>
    typeof segment === 'string' ? null : literalTexts(segment, sink, sourceCode),
  );
  const opaque = new Set<TSESTree.Node>();
  segments.forEach((segment, index) => {
    if (
      typeof segment !== 'string' &&
      choices[index] === null &&
      isProvenSafeValue(segment, sink, 'command', sourceCode, { trustEnvironment })
    ) {
      opaque.add(segment);
    }
  });
  const count = choices.reduce((total, texts) => total * (texts?.length ?? 1), 1);
  if (count > MAX_READINGS) {
    segments.forEach((segment, index) => {
      if (typeof segment !== 'string' && choices[index] !== null) {
        opaque.add(segment);
      }
    });
    return [{ segments, opaque }];
  }
  let readings: (string | TSESTree.Node)[][] = [[]];
  segments.forEach((segment, index) => {
    const texts = choices[index];
    readings =
      texts === null || texts === undefined
        ? readings.map((reading) => [...reading, segment])
        : readings.flatMap((reading) => texts.map((text) => [...reading, text]));
  });
  return readings.map((reading) => ({ segments: reading, opaque }));
}

/**
 * True when a `shell` option value may enable a shell. Only a value that is
 * statically off (`false`, `null`, `undefined`, `''`) is safe; anything decided
 * at run time can be a shell on some machine.
 */
function isShellEnabled(node: TSESTree.Node): boolean {
  const value = unwrapTypeWrappers(node);
  if (value.type === AST_NODE_TYPES.Identifier) {
    return value.name !== 'undefined';
  }
  if (value.type !== AST_NODE_TYPES.Literal) {
    return true;
  }
  return value.value !== false && value.value !== null && value.value !== '';
}

/** True when any argument is an options object requesting a shell. */
function argsRequestShell(args: readonly TSESTree.Node[]): boolean {
  return args.some(
    (arg) =>
      arg.type === AST_NODE_TYPES.ObjectExpression &&
      arg.properties.some(
        (prop) =>
          prop.type === AST_NODE_TYPES.Property &&
          !prop.computed &&
          ((prop.key.type === AST_NODE_TYPES.Identifier && prop.key.name === 'shell') ||
            (prop.key.type === AST_NODE_TYPES.Literal && prop.key.value === 'shell')) &&
          isShellEnabled(prop.value),
      ),
  );
}

/**
 * The args array of `spawn` / `execFile` with a shell, as command text: Node
 * joins `[file, ...args]` with spaces into the string the shell reads. Each
 * element of an inline array is read in place; any other args value (a
 * binding, a call) or a spread element is one runtime value. Null when the
 * call passes no args array.
 */
function shellArgSegments(
  args: readonly TSESTree.CallExpressionArgument[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): { readonly node: TSESTree.Node; readonly segments: (string | TSESTree.Node)[] } | null {
  const list = args[1];
  if (list === undefined || list.type === AST_NODE_TYPES.SpreadElement) {
    return list === undefined ? null : { node: list, segments: [' ', list.argument] };
  }
  const value = unwrapTypeWrappers(list);
  if (
    value.type === AST_NODE_TYPES.ObjectExpression ||
    (value.type === AST_NODE_TYPES.Literal && value.value === null) ||
    (value.type === AST_NODE_TYPES.Identifier && value.name === 'undefined')
  ) {
    return null;
  }
  if (value.type !== AST_NODE_TYPES.ArrayExpression) {
    return { node: list, segments: [' ', value] };
  }
  const segments: (string | TSESTree.Node)[] = [];
  for (const element of value.elements) {
    segments.push(' ');
    if (element?.type === AST_NODE_TYPES.SpreadElement) {
      segments.push(element.argument);
    } else if (element !== null) {
      segments.push(...commandSegments(element, sourceCode));
    }
  }
  return { node: list, segments };
}

/** POSIX shells that run the text after `-c` as a command. */
const POSIX_SHELLS: ReadonlySet<string> = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'ash',
  'fish',
]);
/** Shell options that take the next word as their value (`-o pipefail`). */
const VALUED_SHELL_OPTIONS = /^[-+][a-zA-Z]*[oO]$/u;

/** The static text of a string literal, a template without values or a `const` holding one; else null. */
function staticWord(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | null {
  const segments = commandSegments(node, sourceCode);
  return segments.every((segment) => typeof segment === 'string') ? segments.join('') : null;
}

/** `env` options that take no value. */
const ENV_FLAGS: ReadonlySet<string> = new Set(['-', '-i', '--ignore-environment', '-0', '--null', '--']);

/** Long shell options that take the next word as their value (`--rcfile x`). */
const VALUED_LONG_SHELL_OPTIONS: ReadonlySet<string> = new Set(['--rcfile', '--init-file']);

/** The identifier a member chain starts at (`holder` in `holder.args`), else null. */
function chainRoot(node: TSESTree.Node): TSESTree.Identifier | null {
  let current = unwrapTypeWrappers(node);
  while (current.type === AST_NODE_TYPES.MemberExpression || current.type === AST_NODE_TYPES.ChainExpression) {
    current = unwrapTypeWrappers(current.type === AST_NODE_TYPES.MemberExpression ? current.object : current.expression);
  }
  return current.type === AST_NODE_TYPES.Identifier ? current : null;
}

/** Array methods that read an array without changing it. */
const ARRAY_READ_METHODS: ReadonlySet<string> = new Set(['includes', 'indexOf', 'lastIndexOf', 'join', 'at']);
/** Array methods that add values to an array in place. */
const ARRAY_ADD_METHODS: ReadonlySet<string> = new Set(['push', 'unshift', 'splice']);

/** True for an unshadowed global name read here (`console`, `JSON`, `String`). */
function isGlobalName(node: TSESTree.Node, name: string, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  if (node.type !== AST_NODE_TYPES.Identifier || node.name !== name) {
    return false;
  }
  const variable = ASTUtils.findVariable(sourceCode.getScope(node), node);
  return variable === null || variable.defs.length === 0;
}

/** The name a member reads: `a.push`, `a['push']`; else null. */
function memberKey(member: TSESTree.MemberExpression): string | null {
  if (!member.computed) {
    return member.property.type === AST_NODE_TYPES.Identifier ? member.property.name : null;
  }
  return member.property.type === AST_NODE_TYPES.Literal && typeof member.property.value === 'string'
    ? member.property.value
    : null;
}

/** True when `node` is written by its parent: assigned, updated, deleted or destructured into. */
function isWriteTarget(node: TSESTree.Node): boolean {
  const parent = node.parent;
  switch (parent?.type) {
    case AST_NODE_TYPES.AssignmentExpression:
    case AST_NODE_TYPES.AssignmentPattern:
      return parent.left === node;
    case AST_NODE_TYPES.ForInStatement:
    case AST_NODE_TYPES.ForOfStatement:
      return parent.left === node;
    case AST_NODE_TYPES.UpdateExpression:
    case AST_NODE_TYPES.ArrayPattern:
    case AST_NODE_TYPES.RestElement:
      return true;
    case AST_NODE_TYPES.Property:
      return parent.parent?.type === AST_NODE_TYPES.ObjectPattern;
    case AST_NODE_TYPES.UnaryExpression:
      return parent.operator === 'delete';
    default:
      return false;
  }
}

/**
 * How a use of an args binding off the runner's path treats the array:
 * `read` when it cannot change it (`.length`, an index read, `includes`,
 * `indexOf`, `join`, `console.log(args)`, `JSON.stringify(args)` with no
 * replacer, a template or `+` use, `String(args)`, a spread into a new array
 * literal), `add` for `push` / `unshift` / `splice` with the values they add,
 * `change` for anything else (a write, an alias, any other call).
 */
function argsUse(
  identifier: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
):
  | { readonly kind: 'read' | 'change' }
  | { readonly kind: 'add'; readonly method: string; readonly values: readonly TSESTree.CallExpressionArgument[] } {
  let node: TSESTree.Node = identifier;
  while (
    node.parent !== undefined &&
    (node.parent.type === AST_NODE_TYPES.TSAsExpression ||
      node.parent.type === AST_NODE_TYPES.TSNonNullExpression ||
      node.parent.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      node.parent.type === AST_NODE_TYPES.TSTypeAssertion)
  ) {
    node = node.parent;
  }
  const parent = node.parent;
  const read = { kind: 'read' } as const;
  const change = { kind: 'change' } as const;
  if (parent === undefined) {
    return change;
  }
  if (parent.type === AST_NODE_TYPES.MemberExpression && parent.object === node) {
    const key = memberKey(parent);
    const call = parent.parent;
    if (call?.type === AST_NODE_TYPES.CallExpression && call.callee === parent) {
      if (key !== null && ARRAY_READ_METHODS.has(key)) {
        return read;
      }
      return key !== null && ARRAY_ADD_METHODS.has(key)
        ? { kind: 'add', method: key, values: key === 'splice' ? call.arguments.slice(2) : call.arguments }
        : change;
    }
    // `.length` or an index read, neither written nor called (a call would get the array as `this`).
    const used = call?.type === AST_NODE_TYPES.ChainExpression ? call : parent;
    const elementRead = key === 'length' || (parent.computed && (key === null || /^\d+$/u.test(key)));
    const outer = used.parent;
    const calledWithThis =
      (outer?.type === AST_NODE_TYPES.CallExpression && outer.callee === used) ||
      (outer?.type === AST_NODE_TYPES.TaggedTemplateExpression && outer.tag === used);
    return elementRead && !isWriteTarget(used) && !calledWithThis ? read : change;
  }
  if (parent.type === AST_NODE_TYPES.TemplateLiteral) {
    return read;
  }
  if (parent.type === AST_NODE_TYPES.BinaryExpression && parent.operator === '+') {
    return read;
  }
  if (parent.type === AST_NODE_TYPES.SpreadElement && parent.parent?.type === AST_NODE_TYPES.ArrayExpression) {
    return read;
  }
  if (parent.type === AST_NODE_TYPES.CallExpression && parent.callee !== node) {
    const callee = parent.callee;
    if (callee.type === AST_NODE_TYPES.MemberExpression && isGlobalName(callee.object, 'console', sourceCode)) {
      return read;
    }
    const [first, second] = parent.arguments;
    if (
      first === node &&
      callee.type === AST_NODE_TYPES.MemberExpression &&
      isGlobalName(callee.object, 'JSON', sourceCode) &&
      memberKey(callee) === 'stringify' &&
      (second === undefined || (second.type === AST_NODE_TYPES.Literal && second.value === null))
    ) {
      return read;
    }
    if (first === node && parent.arguments.length === 1 && isGlobalName(callee, 'String', sourceCode)) {
      return read;
    }
  }
  return change;
}

/** True when every value is fixed text: no spread, no runtime piece. */
function allFixedWords(
  values: readonly (TSESTree.Node | null)[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  return values.every(
    (value) => value !== null && value.type !== AST_NODE_TYPES.SpreadElement && staticWord(value, sourceCode) !== null,
  );
}

/**
 * The array literal an args list is, or (as in `const args = ['-c', cmd]`)
 * holds, with the elements the runner can see. `changed` when a binding it
 * passed through may change before the call (`args[1] = x`, `const a = args`,
 * `fill(args)`, see {@link argsUse}): the elements at the call may then differ
 * from the literal. Values added with `push` stand after the elements; values
 * added with `unshift` or `splice` keep the list known only when every
 * element and every added value is fixed text. Any added runtime value is a
 * change.
 */
function argsArray(
  list: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): {
  readonly array: TSESTree.ArrayExpression;
  readonly elements: readonly (TSESTree.Node | null)[];
  readonly changed: boolean;
} | null {
  const steps = flowSteps(list, list, sourceCode, 'taint');
  const onPath = new Set<TSESTree.Node>(steps.map((step) => step.node));
  let changed = false;
  const pushed: TSESTree.Node[] = [];
  let placed = false;
  for (const step of steps) {
    const value = unwrapTypeWrappers(step.node);
    if (value.type === AST_NODE_TYPES.ArrayExpression) {
      if (changed || (pushed.length === 0 && !placed)) {
        return { array: value, elements: value.elements, changed };
      }
      // Fixed text added in place keeps the list known, the added text
      // included. `unshift` and `splice` (which may also remove elements)
      // move the elements, so they keep it known only when all of it is fixed.
      const elements = [...value.elements, ...pushed];
      return placed && !allFixedWords(elements, sourceCode)
        ? { array: value, elements: value.elements, changed: true }
        : { array: value, elements, changed: false };
    }
    const root = chainRoot(step.node);
    const variable = root === null ? null : ASTUtils.findVariable(sourceCode.getScope(root), root);
    if (root !== null && variable === null) {
      changed = true;
    }
    // Reads are told apart only for a binding that holds the list itself, not a holder of it.
    const holdsList = root !== null && unwrapTypeWrappers(step.node) === root;
    for (const reference of variable?.references ?? []) {
      const write = reference.writeExpr;
      const onlyThePath =
        reference.identifier === root ||
        (reference.init === true && write !== null && write !== undefined) ||
        (write !== null && write !== undefined && onPath.has(write)) ||
        isRunnerArgs(reference.identifier, sourceCode);
      if (onlyThePath) {
        continue;
      }
      const use = holdsList && !reference.isWrite() ? argsUse(reference.identifier, sourceCode) : { kind: 'change' as const };
      if (use.kind === 'add' && allFixedWords(use.values, sourceCode)) {
        pushed.push(...(use.values as TSESTree.Node[]));
        placed ||= use.method !== 'push';
      } else if (use.kind !== 'read') {
        changed = true;
      }
    }
  }
  // The walk stops at a binding written more than once (`let args = [...]`,
  // then `args = [...]`) or a holder written in place: any array written
  // there is the list as far as the program goes, with unknown elements.
  const last = steps.at(-1)?.node;
  const root = last === undefined ? null : chainRoot(last);
  const variable = root === null ? null : ASTUtils.findVariable(sourceCode.getScope(root), root);
  const key = last?.type === AST_NODE_TYPES.MemberExpression && !last.computed && last.property.type === AST_NODE_TYPES.Identifier
    ? last.property.name
    : null;
  let found: TSESTree.ArrayExpression | null = null;
  let unknown = false;
  for (const reference of variable?.references ?? []) {
    if (reference.identifier === root || isRunnerArgs(reference.identifier, sourceCode)) {
      continue;
    }
    const write = reference.writeExpr === null || reference.writeExpr === undefined ? null : unwrapTypeWrappers(reference.writeExpr);
    const array = writtenArray(write, last === root ? null : key);
    if (array === null) {
      unknown = true;
      continue;
    }
    found ??= array;
    // Arrays of fixed words written in turn run nothing from the request.
    if (!allFixedWords(array.elements, sourceCode)) {
      unknown = true;
    }
  }
  return found === null || !unknown ? null : { array: found, elements: found.elements, changed: true };
}

/** The array a write puts in the binding, or under `key` of the object it puts there. */
function writtenArray(write: TSESTree.Node | null, key: string | null): TSESTree.ArrayExpression | null {
  if (key === null) {
    return write?.type === AST_NODE_TYPES.ArrayExpression ? write : null;
  }
  if (write?.type !== AST_NODE_TYPES.ObjectExpression) {
    return null;
  }
  const entry = write.properties.find(
    (property): property is TSESTree.Property =>
      property.type === AST_NODE_TYPES.Property &&
      !property.computed &&
      ((property.key.type === AST_NODE_TYPES.Identifier && property.key.name === key) ||
        (property.key.type === AST_NODE_TYPES.Literal && property.key.value === key)),
  );
  const value = entry === undefined ? null : unwrapTypeWrappers(entry.value);
  return value?.type === AST_NODE_TYPES.ArrayExpression ? value : null;
}

/** True when `identifier` is the args list of another runner call, which only reads it. */
function isRunnerArgs(identifier: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const call = identifier.parent;
  if (call?.type !== AST_NODE_TYPES.CallExpression || call.arguments[1] !== identifier) {
    return false;
  }
  const info = resolvedCalleeInfo(call.callee, sourceCode);
  return info !== null && CONDITIONAL_SHELL.has(info.name);
}

/**
 * Where `env` (`spawn('/usr/bin/env', ['sh', '-c', cmd])`) names the program
 * it runs, after its variable assignments and the options it knows, else -1.
 */
function envProgramIndex(
  elements: readonly (TSESTree.Node | null)[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): number {
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (element === null || element === undefined || element.type === AST_NODE_TYPES.SpreadElement) {
      return -1;
    }
    const word = staticWord(element, sourceCode);
    if (word === null) {
      return -1;
    }
    if (word === '-u' || word === '--unset') {
      index += 1;
    } else if (!ENV_FLAGS.has(word) && !/^[A-Za-z_]\w*=/u.test(word) && !/^--unset=/u.test(word)) {
      // Any other option (`-S` splits its value into words) is not read.
      return /^-/u.test(word) ? -1 : index;
    }
  }
  return -1;
}

/**
 * For `spawn('sh', ['-c', cmd])` (or `execFile`, `bash -lc`, `cmd /c`,
 * `/usr/bin/env sh -c`) run without a shell option, the element the shell
 * reads as its command and, for `cmd.exe`, the elements after it, which it
 * reads as the rest of the line. The args may be an array literal or a
 * binding that holds one; `unknown` when that binding may have been changed
 * before the call, so the command is whatever was put there. Null when the
 * program is not a known shell, the args are not such an array or no command
 * element is found.
 */
function shellProgramCommand(
  args: readonly TSESTree.CallExpressionArgument[],
  sourceCode: Readonly<TSESLint.SourceCode>,
): {
  readonly node: TSESTree.Node;
  readonly rest: readonly TSESTree.Node[];
  readonly reportAt: TSESTree.Node;
  readonly unknown?: boolean;
} | null {
  const [program, list] = args;
  if (program === undefined || program.type === AST_NODE_TYPES.SpreadElement) {
    return null;
  }
  const text = staticWord(program, sourceCode);
  const held = list === undefined || list.type === AST_NODE_TYPES.SpreadElement ? null : argsArray(list, sourceCode);
  if (text === null || list === undefined || held === null) {
    return null;
  }
  const array = held.array;
  // A list held in a binding is reported where the call reads it.
  const inline = unwrapTypeWrappers(list) === array;
  const at = (node: TSESTree.Node): TSESTree.Node => (inline ? node : list);
  let name = commandName(text).toLowerCase().replace(/\.exe$/u, '');
  let start = 0;
  if (name === 'env') {
    start = envProgramIndex(held.elements, sourceCode);
    const shell = held.elements[start];
    const word = start === -1 || shell === undefined || shell === null ? null : staticWord(shell, sourceCode);
    if (word === null) {
      return null;
    }
    name = commandName(word).toLowerCase().replace(/\.exe$/u, '');
    start += 1;
  }
  const windows = name === 'cmd';
  if (!windows && !POSIX_SHELLS.has(name)) {
    return null;
  }
  if (held.changed) {
    return { node: list, rest: [], reportAt: list, unknown: true };
  }
  const elements = held.elements;
  let commandFlag = false;
  for (let index = start; index < elements.length; index += 1) {
    const element = elements[index];
    if (element === null || element === undefined) {
      continue;
    }
    if (element.type === AST_NODE_TYPES.SpreadElement) {
      return null;
    }
    const word = staticWord(element, sourceCode);
    if (windows) {
      if (word !== null && /^\/[ck]$/iu.test(word)) {
        const rest = elements.slice(index + 1);
        const first = rest[0];
        return first === null ||
          first === undefined ||
          rest.some((item) => item === null || item.type === AST_NODE_TYPES.SpreadElement)
          ? null
          : { node: first, rest: rest.slice(1) as TSESTree.Node[], reportAt: at(first) };
      }
      continue;
    }
    if (commandFlag && (word === null || !/^[-+]/u.test(word))) {
      return { node: element, rest: [], reportAt: at(element) };
    }
    if (word === null) {
      // A runtime option before `-c` may be anything; nothing is read.
      return null;
    }
    if (word === '--') {
      continue;
    }
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/u.test(word) || word === '--command') {
      commandFlag = true;
    } else if (VALUED_SHELL_OPTIONS.test(word) || VALUED_LONG_SHELL_OPTIONS.has(word.toLowerCase())) {
      index += 1;
    } else if (!/^[-+]/u.test(word) && !commandFlag) {
      // A script path: the shell runs a file, not text from the call.
      return null;
    }
  }
  return null;
}

/** True when `node` (or the in-file `const` it names) builds a string from runtime parts. */
function buildsCommand(node: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  let current: TSESTree.Node | null = peelStringWrappers(node, sourceCode);
  for (let depth = 0; current !== null && depth < MAX_CONST_DEPTH; depth += 1) {
    if (isDynamicCommandString(current, sourceCode)) {
      return true;
    }
    current = constStringInit(current, sourceCode);
  }
  return false;
}

/** True when `callee` is `promisify` or `<x>.promisify` (`util.promisify`). */
function isPromisify(callee: TSESTree.Node, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const info = resolvedCalleeInfo(callee, sourceCode);
  return info !== null && info.name === 'promisify';
}

/** The runner a `child_process` function reference names (`exec`, `cp.execFile`), else null. */
function childProcessRunner(
  node: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | null {
  const info = resolvedCalleeInfo(node, sourceCode);
  if (info === null) {
    return null;
  }
  if (
    info.isMember &&
    !(info.objectName !== undefined && CHILD_PROCESS_OBJECT.test(info.objectName))
  ) {
    return null;
  }
  return ALWAYS_SHELL.has(info.name) || CONDITIONAL_SHELL.has(info.name) ? info.name : null;
}

/**
 * The runner a local binding wraps when it was made with
 * `const execAsync = promisify(exec)`, followed through scope; else null.
 */
function promisifiedRunner(
  callee: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): string | null {
  const variable = ASTUtils.findVariable(sourceCode.getScope(callee), callee);
  const definition = variable?.defs[0];
  if (definition?.node.type !== AST_NODE_TYPES.VariableDeclarator) {
    return null;
  }
  const init = definition.node.init === null ? null : unwrapTypeWrappers(definition.node.init);
  if (init?.type !== AST_NODE_TYPES.CallExpression || !isPromisify(init.callee, sourceCode)) {
    return null;
  }
  const wrapped = init.arguments[0];
  return wrapped === undefined ? null : childProcessRunner(wrapped, sourceCode);
}

export const noShellInterpolationRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'A dynamically-interpolated command string must not flow into a shell runner (`exec`/`execSync`, or `spawn`/`execFile` with a `shell` option that is not `false`), including through `promisify(exec)`. Pass the program and arguments separately.',
      cwe: ['CWE-78'],
      owasp: ['A03:2021'],
      securitySeverity: 9.8,
    },
    schema: [optionSchema],
    messages: {
      shellInterpolation:
        'A dynamically-built command string is passed to `{{callee}}`, which runs it through a shell (a command-injection sink). Pass the program and its arguments separately instead (e.g. `execFile(cmd, [arg1, arg2])`), where no shell re-parses the string.',
    },
  },
  defaultOptions: [{ extraCallees: [], trustEnvironment: false }],
  create(context, [options]) {
    const extra = options.extraCallees ?? [];
    const alwaysShell = new Set([...ALWAYS_SHELL, ...extra]);

    return {
      CallExpression(node): void {
        const direct = getCalleeInfo(node.callee);
        if (direct === null) {
          return;
        }
        const wrapped =
          node.callee.type === AST_NODE_TYPES.Identifier
            ? promisifiedRunner(node.callee, context.sourceCode)
            : null;
        // The callee as written, then under the usual names of its imports.
        const info = [direct, resolvedCalleeInfo(node.callee, context.sourceCode)]
          .map((candidate): CalleeInfo | null =>
            candidate === null || wrapped === null ? candidate : { ...candidate, name: wrapped },
          )
          .find(
            (candidate): candidate is CalleeInfo =>
              candidate !== null &&
              (alwaysShell.has(candidate.name) || CONDITIONAL_SHELL.has(candidate.name)) &&
              // Exclude `regex.exec(...)`: `exec` as a member on a non-child_process
              // object is RegExp.prototype.exec, never a shell runner.
              !(
                candidate.name === 'exec' &&
                candidate.isMember &&
                !(candidate.objectName !== undefined && CHILD_PROCESS_OBJECT.test(candidate.objectName))
              ),
          );
        if (info === undefined) {
          return;
        }

        const args = callArguments(node.arguments, context.sourceCode);
        const command = args[0];
        if (command === undefined || command.type === AST_NODE_TYPES.SpreadElement) {
          return;
        }

        // Every runtime part already proven harmless: checked against an
        // allowlist or a shell-inert anchored regex, a schema with such a
        // pattern, an in-file constant, or (with `trustEnvironment`) a value
        // from `process.env`.
        const trustEnvironment = options.trustEnvironment === true;
        // A value that starts a word must not start with `-` (an option) or
        // `#` (a comment); one glued to text before it may. A value in the
        // program name is proven only by a literal allowlist or a constant.
        const proven = new Map<string, boolean>();
        const provenAt = (part: TSESTree.Node, where: GuardContext): boolean => {
          const key = `${part.range.join(':')}:${where}`;
          let known = proven.get(key);
          if (known === undefined) {
            known = isProvenSafeValue(part, node, where, context.sourceCode, { trustEnvironment });
            proven.set(key, known);
          }
          return known;
        };
        const provenCommand = (segments: Segments): boolean =>
          commandReadings(segments, node, context.sourceCode, trustEnvironment).every((reading) =>
            classifyShellParts(reading.segments, reading.opaque).every((part) =>
              partContexts(part).every((where) => provenAt(part.node, where)),
            ),
          );

        const runsShell =
          alwaysShell.has(info.name) ||
          (CONDITIONAL_SHELL.has(info.name) && argsRequestShell(args));
        if (!runsShell) {
          // No shell option, but the program is a shell told to run a
          // command: `spawn('sh', ['-c', cmd])`.
          const program = CONDITIONAL_SHELL.has(info.name)
            ? shellProgramCommand(args, context.sourceCode)
            : null;
          if (program === null) {
            return;
          }
          if (program.unknown === true) {
            context.report({ node: program.reportAt, messageId: 'shellInterpolation', data: { callee: direct.name } });
            return;
          }
          // `cmd.exe` reads the elements after the command as more of the
          // line, so a runtime one is command text like a joined args array.
          const rest = program.rest.flatMap((part) => [
            ' ',
            ...commandSegments(part, context.sourceCode),
          ]);
          // The command may reach the array through a holder, an element, a
          // local identity function or a callback (`holder.value`). Its parts
          // are proven only along an exact move; a looser one still reports.
          const exact = flowSteps(program.node, node, context.sourceCode).find((step) =>
            buildsCommand(step.node, context.sourceCode),
          );
          const built =
            exact !== undefined ||
            flowSteps(program.node, node, context.sourceCode, 'taint').some((step) =>
              buildsCommand(step.node, context.sourceCode),
            );
          if (!built && rest.every((segment) => typeof segment === 'string')) {
            return;
          }
          const segments = [
            ...commandSegments(exact?.node ?? program.node, context.sourceCode),
            ...rest,
          ];
          if (!provenCommand(segments)) {
            context.report({
              node: program.reportAt,
              messageId: 'shellInterpolation',
              data: { callee: direct.name },
            });
          }
          return;
        }
        const shellArgs = CONDITIONAL_SHELL.has(info.name)
          ? shellArgSegments(args, context.sourceCode)
          : null;
        const dynamicCommand = isDynamicCommandString(command, context.sourceCode);
        const dynamicArgs =
          shellArgs !== null && shellArgs.segments.some((segment) => typeof segment !== 'string');
        if (!dynamicCommand && !dynamicArgs) {
          return;
        }
        const segments = [
          ...commandSegments(command, context.sourceCode),
          ...(shellArgs?.segments ?? []),
        ];
        if (provenCommand(segments)) {
          return;
        }
        context.report({
          node: dynamicCommand || shellArgs === null ? command : shellArgs.node,
          messageId: 'shellInterpolation',
          data: { callee: direct.name },
        });
      },
    };
  },
});
