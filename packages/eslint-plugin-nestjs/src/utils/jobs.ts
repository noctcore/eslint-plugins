import path from 'node:path';

import { createFileCache, findRepoRoot } from '@noctcore/eslint-utils';
import { ASTUtils, AST_NODE_TYPES, type TSESLint, type TSESTree } from '@typescript-eslint/utils';

import {
  BULLMQ_MODULE,
  classChain,
  createBindingResolver,
  isBullmqNew,
  listenerChain,
  stripTypeWrappers,
  thisClass,
  workerBinding,
  type ClassNode,
} from './bullmq';
import { receiverLooksLikeQueue } from './queue';

/*
 * Shared ground for the rules that keep an app on `@noctcore/jobs`: whether a
 * file or its project uses the package, which import a name comes from, and
 * what kind of queue a call's receiver holds.
 */

/** The package these rules keep an app on. */
export const JOBS_MODULE = '@noctcore/jobs';

/** NestJS's own BullMQ integration, which `@noctcore/jobs` replaces. */
export const NEST_BULLMQ_MODULE = '@nestjs/bullmq';

/** Where a name in the file was imported from, and under which exported name. */
export interface ImportRef {
  readonly module: string;
  readonly name: string;
}

/**
 * The module and exported name `identifier` is imported under, following a
 * rename (`import { Worker as JobWorker } from '@noctcore/jobs'` gives
 * `Worker`). Resolved through scope, so a local of the same name that shadows
 * the import is not mistaken for it. A type-only import counts, because a type
 * annotation is read through it. Null for a default or namespace import and for
 * anything that is not an import.
 */
export function importRef(identifier: TSESTree.Identifier, scope: TSESLint.Scope.Scope): ImportRef | null {
  const def = ASTUtils.findVariable(scope, identifier)?.defs[0];
  if (def?.type !== 'ImportBinding' || def.node.type !== AST_NODE_TYPES.ImportSpecifier) return null;
  const declaration = def.parent;
  if (declaration.type !== AST_NODE_TYPES.ImportDeclaration) return null;
  const imported = def.node.imported;
  return {
    module: declaration.source.value,
    name: imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value,
  };
}

/** True when `node` is an identifier imported as `name` from `module`. */
export function isImportOf(
  node: TSESTree.Node | null | undefined,
  module: string,
  name: string,
  sourceCode: Readonly<TSESLint.SourceCode>,
): boolean {
  if (node?.type !== AST_NODE_TYPES.Identifier) return false;
  const ref = importRef(node, sourceCode.getScope(node));
  return ref !== null && ref.module === module && ref.name === name;
}

/** True when the file has an `import ... from '<module>'`, type-only included. */
export function fileImports(sourceCode: Readonly<TSESLint.SourceCode>, module: string): boolean {
  return sourceCode.ast.body.some(
    (statement) => statement.type === AST_NODE_TYPES.ImportDeclaration && statement.source.value === module,
  );
}

const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/** The dependency names a `package.json` declares, or null when it is not valid JSON. */
const manifests = createFileCache((text): ReadonlySet<string> | null => {
  try {
    const manifest = JSON.parse(text) as Record<string, unknown>;
    const names = new Set<string>();
    for (const field of DEPENDENCY_FIELDS) {
      const deps = manifest[field];
      if (typeof deps === 'object' && deps !== null) {
        for (const name of Object.keys(deps)) names.add(name);
      }
    }
    return names;
  } catch {
    return null;
  }
});

/**
 * True when a `package.json` between the file's directory and the workspace
 * root (both included) declares `module` as a dependency of any kind. Without
 * a workspace root the walk goes up to the file system root.
 */
export function packageDeclares(filename: string, cwd: string, module: string): boolean {
  let dir = path.dirname(path.resolve(cwd, filename));
  const root = findRepoRoot(dir);
  for (;;) {
    if (manifests.get(path.join(dir, 'package.json'))?.has(module) === true) return true;
    if (dir === root) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/**
 * True when the linted file belongs to an app that uses `@noctcore/jobs`: the
 * file imports it, or a `package.json` from the file's directory up to the
 * workspace root declares it. The second half is what lets a file with a
 * hand-built BullMQ queue, which has no reason to import the package, be
 * reported in an app that has moved to it.
 */
export function usesJobs(context: Readonly<TSESLint.RuleContext<string, readonly unknown[]>>): boolean {
  return (
    fileImports(context.sourceCode, JOBS_MODULE) || packageDeclares(context.filename, context.cwd, JOBS_MODULE)
  );
}

/** What a call's receiver is known to hold. */
export type ReceiverKind = 'jobQueue' | 'bullmqQueue' | 'bullmqWorker';

/** The kind an annotation like `JobQueue<...>`, `Queue` or `Worker` names, or null. */
function annotationKind(
  annotation: TSESTree.TSTypeAnnotation | undefined,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReceiverKind | null {
  const type = annotation?.typeAnnotation;
  if (type?.type !== AST_NODE_TYPES.TSTypeReference || type.typeName.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }
  const ref = importRef(type.typeName, sourceCode.getScope(type.typeName));
  if (ref === null) return null;
  if (ref.module === JOBS_MODULE && ref.name === 'JobQueue') return 'jobQueue';
  if (ref.module === BULLMQ_MODULE && ref.name === 'Queue') return 'bullmqQueue';
  if (ref.module === BULLMQ_MODULE && ref.name === 'Worker') return 'bullmqWorker';
  return null;
}

/** The kind an `@InjectQueue(...)` among `decorators` injects, or null. */
function decoratorKind(
  decorators: readonly TSESTree.Decorator[] | undefined,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReceiverKind | null {
  for (const decorator of decorators ?? []) {
    const expression = decorator.expression;
    if (expression.type !== AST_NODE_TYPES.CallExpression) continue;
    if (isImportOf(expression.callee, JOBS_MODULE, 'InjectQueue', sourceCode)) return 'jobQueue';
    if (isImportOf(expression.callee, NEST_BULLMQ_MODULE, 'InjectQueue', sourceCode)) return 'bullmqQueue';
  }
  return null;
}

/** The kind a `new Queue(...)` or `new Worker(...)` from bullmq builds, or null. */
function constructedKind(
  init: TSESTree.Node | null | undefined,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReceiverKind | null {
  if (init === null || init === undefined) return null;
  const value = stripTypeWrappers(init);
  const scope = sourceCode.getScope(value);
  if (isBullmqNew(value, 'Queue', scope)) return 'bullmqQueue';
  if (isBullmqNew(value, 'Worker', scope)) return 'bullmqWorker';
  return null;
}

/** The kind of a parameter: its injection decorator first, then its annotation. */
function parameterKind(
  parameter: TSESTree.Node,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReceiverKind | null {
  let node = parameter;
  let decorators: readonly TSESTree.Decorator[] = [];
  if (node.type === AST_NODE_TYPES.TSParameterProperty) {
    decorators = node.decorators;
    node = node.parameter;
  }
  if (node.type === AST_NODE_TYPES.AssignmentPattern) node = node.left;
  if (node.type !== AST_NODE_TYPES.Identifier) return null;
  return (
    decoratorKind(decorators, sourceCode) ??
    decoratorKind(node.decorators, sourceCode) ??
    annotationKind(node.typeAnnotation, sourceCode)
  );
}

/** The name a constructor parameter property declares, or null. */
function parameterPropertyName(parameter: TSESTree.Parameter): string | null {
  if (parameter.type !== AST_NODE_TYPES.TSParameterProperty) return null;
  const inner = parameter.parameter;
  const id = inner.type === AST_NODE_TYPES.AssignmentPattern ? inner.left : inner;
  return id.type === AST_NODE_TYPES.Identifier ? id.name : null;
}

/** The kind of the instance member `name` of `owner`, from its declaration. */
function memberKind(
  owner: ClassNode,
  name: string,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReceiverKind | null {
  for (const member of owner.body.body) {
    if (
      member.type === AST_NODE_TYPES.PropertyDefinition &&
      !member.static &&
      !member.computed &&
      member.key.type === AST_NODE_TYPES.Identifier &&
      member.key.name === name
    ) {
      return annotationKind(member.typeAnnotation, sourceCode) ?? constructedKind(member.value, sourceCode);
    }
    if (member.type === AST_NODE_TYPES.MethodDefinition && member.kind === 'constructor') {
      const parameter = member.value.params.find((param) => parameterPropertyName(param) === name);
      if (parameter !== undefined) return parameterKind(parameter, sourceCode);
    }
  }
  return null;
}

/** True when `owner`, or a base class this file declares, extends NestJS's `WorkerHost`. */
function extendsWorkerHost(owner: ClassNode, sourceCode: Readonly<TSESLint.SourceCode>): boolean {
  const { classes } = classChain(owner, sourceCode);
  return classes.some((cls) => isImportOf(cls.superClass, NEST_BULLMQ_MODULE, 'WorkerHost', sourceCode));
}

/** The kind of a variable, from its declaration. */
function variableKind(
  identifier: TSESTree.Identifier,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReceiverKind | null {
  const def = ASTUtils.findVariable(sourceCode.getScope(identifier), identifier)?.defs[0];
  if (def?.type === 'Parameter') {
    // `@InjectQueue(q) private readonly queue = fallback`: the decorators sit on
    // the parameter property, the annotation on the identifier inside it.
    let holder: TSESTree.Node = def.name;
    if (holder.parent?.type === AST_NODE_TYPES.AssignmentPattern) holder = holder.parent;
    if (holder.parent?.type === AST_NODE_TYPES.TSParameterProperty) holder = holder.parent;
    return parameterKind(holder, sourceCode);
  }
  if (def?.type === 'Variable' && def.node.id.type === AST_NODE_TYPES.Identifier) {
    return annotationKind(def.node.id.typeAnnotation, sourceCode) ?? constructedKind(def.node.init, sourceCode);
  }
  return null;
}

/** What one file's receivers hold, once the whole file has been visited. */
export interface ReceiverIndex {
  /** Records a bullmq `new Queue(...)` or `new Worker(...)` and the bindings it is stored in. */
  record(node: TSESTree.NewExpression): void;
  /**
   * What `receiver` holds: `x.bull` is a JobQueue's BullMQ queue; a binding is
   * read from a recorded construction, then from its declaration (an
   * `@InjectQueue` from either package, a `JobQueue`, `Queue` or `Worker`
   * annotation, a `new Queue(...)` initialiser); `this.worker` in a class that
   * extends NestJS's `WorkerHost` is its BullMQ worker. Null when nothing in the
   * file says.
   */
  kind(receiver: TSESTree.Node): ReceiverKind | null;
}

export function createReceiverIndex(sourceCode: Readonly<TSESLint.SourceCode>): ReceiverIndex {
  const resolver = createBindingResolver(sourceCode);
  const constructed = new Map<string, ReceiverKind>();

  function declared(receiver: TSESTree.Node): ReceiverKind | null {
    if (receiver.type === AST_NODE_TYPES.Identifier) return variableKind(receiver, sourceCode);
    if (
      receiver.type !== AST_NODE_TYPES.MemberExpression ||
      receiver.computed ||
      receiver.property.type !== AST_NODE_TYPES.Identifier ||
      stripTypeWrappers(receiver.object).type !== AST_NODE_TYPES.ThisExpression
    ) {
      return null;
    }
    const owner = thisClass(receiver);
    if (owner === null) return null;
    const name = receiver.property.name;
    for (const cls of classChain(owner, sourceCode).classes) {
      const kind = memberKind(cls, name, sourceCode);
      if (kind !== null) return kind;
    }
    return name === 'worker' && extendsWorkerHost(owner, sourceCode) ? 'bullmqWorker' : null;
  }

  return {
    record(node): void {
      const kind = constructedKind(node, sourceCode);
      if (kind === null) return;
      const binding = workerBinding(listenerChain(node).top, resolver);
      if (binding.kind !== 'bound') return;
      for (const ref of binding.refs) constructed.set(ref.key, kind);
    },
    kind(node): ReceiverKind | null {
      const receiver = stripTypeWrappers(node);
      if (
        receiver.type === AST_NODE_TYPES.MemberExpression &&
        !receiver.computed &&
        receiver.property.type === AST_NODE_TYPES.Identifier &&
        receiver.property.name === 'bull'
      ) {
        return 'bullmqQueue';
      }
      const direct = constructedKind(receiver, sourceCode);
      if (direct !== null) return direct;
      const ref = resolver.ref(receiver);
      const recorded = ref === null ? undefined : constructed.get(ref.key);
      return recorded ?? declared(receiver);
    },
  };
}

/** The receiver and method name of `<receiver>.<method>(...)`, or null. */
export function methodCall(
  node: TSESTree.CallExpression,
): { readonly receiver: TSESTree.Expression; readonly method: string } | null {
  const callee = node.callee;
  if (
    callee.type !== AST_NODE_TYPES.MemberExpression ||
    callee.computed ||
    callee.property.type !== AST_NODE_TYPES.Identifier
  ) {
    return null;
  }
  return { receiver: callee.object, method: callee.property.name };
}

/**
 * True when `receiver` holds a `JobQueue`: the file says so (see
 * `ReceiverIndex.kind`), or, when it says nothing, the receiver's name matches
 * `pattern` the way the other queue rules read it. A receiver the file shows to
 * be a BullMQ queue or worker is never a `JobQueue`.
 */
export function isJobQueueReceiver(receiver: TSESTree.Node, index: ReceiverIndex, pattern: RegExp): boolean {
  const kind = index.kind(receiver);
  if (kind !== null) return kind === 'jobQueue';
  return receiverLooksLikeQueue(stripTypeWrappers(receiver), pattern);
}

/** JSON schema of the `allowIn` option the BullMQ-in-a-jobs-app rules share. */
export const allowInSchema = {
  type: 'array',
  items: { type: 'string' },
  uniqueItems: true,
  description: 'Globs of files the rule skips, such as seed scripts or tests that drive BullMQ directly. Default none.',
} as const;
