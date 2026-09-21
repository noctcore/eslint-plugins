import ts from 'typescript';

import { PRISMA_DELEGATE_METHODS, PRISMA_WRITE_METHODS } from './prisma-methods';

/**
 * A whole-program walk over the TypeScript call graph, answering one question
 * for one function: does anything it can reach write through Prisma, and does
 * anything it can reach write the audit log?
 *
 * A per-file rule cannot answer that. In a layered service the write sits in a
 * repository, the audit sits in the service that orchestrates it, and the
 * entry point that a client calls is a third file. The type checker already
 * resolved every one of those calls, so this walks the resolved declarations
 * instead of guessing from names.
 *
 * The walk is built to be conservative in one direction only. A function it
 * cannot see into (an interface method, an abstract method, a callback held in
 * a parameter, a value typed `any`) makes the result OPAQUE, and an opaque
 * result is never reported: the unseen code might be the audit. Library code
 * (a declaration file, anything under `node_modules`) is assumed to neither
 * write through Prisma nor write the audit log, which is what makes the walk
 * finite; the Prisma write itself is recognised at the call site, before the
 * call is resolved into the client's declarations.
 */

/** A Prisma write the walk found. */
export interface WriteSite {
  /** Model delegate accessor the write went through (`invoice`), or `?` when not statically named. */
  readonly model: string;
  /** Delegate method (`update`). */
  readonly method: string;
  readonly fileName: string;
  /** 1-based line of the write call. */
  readonly line: number;
}

export interface AuditGraphOptions {
  /** Case-insensitive: a receiver whose name matches is an audit logger. */
  readonly auditReceiverPattern: RegExp;
  /** Methods on an audit logger that write an audit row. */
  readonly auditMethods: ReadonlySet<string>;
  /** Model delegates whose writes ARE the audit row (`auditLog`). */
  readonly auditModels: ReadonlySet<string>;
  /** Model delegates whose writes do not need an audit row. */
  readonly unauditedModels: ReadonlySet<string>;
  /** Case-insensitive: a receiver chain containing a matching name is a Prisma client. */
  readonly receiverPattern: RegExp;
  /** Property names that expose a Prisma client without matching `receiverPattern`. */
  readonly clientProperties: ReadonlySet<string>;
  /** Root identifiers that are a Prisma transaction client. */
  readonly txRootNames: ReadonlySet<string>;
  /** Calls deeper than this from the entry make the result opaque. */
  readonly maxDepth: number;
}

/** What one function body does directly, before following its calls. */
interface BodyFacts {
  readonly writes: readonly WriteSite[];
  readonly audits: boolean;
  readonly callees: readonly ts.FunctionLikeDeclaration[];
  /** Why the body calls something the walk cannot see into, or null. */
  readonly opaque: string | null;
}

export type AuditGraphVerdict =
  | { readonly kind: 'audited' }
  | { readonly kind: 'no-write' }
  | { readonly kind: 'opaque'; readonly reason: string }
  | {
      readonly kind: 'unaudited';
      readonly write: WriteSite;
      /** The functions from the entry to the one holding the write, labelled. */
      readonly path: readonly string[];
    };

/*
 * Raw SQL (`$executeRaw`) is deliberately NOT a write here. Its text is the only
 * thing that says whether it writes, and the most common `$executeRaw` in a
 * service layer is `SELECT pg_advisory_xact_lock(...)`, which writes nothing.
 * Counting it reported a lock as an unaudited mutation, so raw SQL is a stated
 * blind spot instead.
 */
const WRITE_METHODS: ReadonlySet<string> = new Set(PRISMA_WRITE_METHODS);
const DELEGATE_METHODS: ReadonlySet<string> = new Set(PRISMA_DELEGATE_METHODS);

/** Strip the wrappers that do not change which value an expression is. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * The TypeScript-AST twin of `receiverLooksLikePrisma`, plus the shapes a
 * repository uses to pick its client: `(tx ?? this.client)` and
 * `tx ? tx : this.client`, where either branch naming a client is enough.
 */
function receiverLooksLikePrisma(node: ts.Expression, options: AuditGraphOptions): boolean {
  const current = unwrap(node);
  if (ts.isPropertyAccessExpression(current)) {
    const name = current.name.text;
    if (options.clientProperties.has(name) || options.receiverPattern.test(name)) {
      return true;
    }
    return receiverLooksLikePrisma(current.expression, options);
  }
  if (ts.isElementAccessExpression(current)) {
    return receiverLooksLikePrisma(current.expression, options);
  }
  if (
    ts.isBinaryExpression(current) &&
    (current.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      current.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return (
      receiverLooksLikePrisma(current.left, options) ||
      receiverLooksLikePrisma(current.right, options)
    );
  }
  if (ts.isConditionalExpression(current)) {
    return (
      receiverLooksLikePrisma(current.whenTrue, options) ||
      receiverLooksLikePrisma(current.whenFalse, options)
    );
  }
  if (ts.isIdentifier(current)) {
    return options.txRootNames.has(current.text) || options.receiverPattern.test(current.text);
  }
  return false;
}

/**
 * True when the call resolves into a generated Prisma model delegate
 * (`interface InvoiceDelegate { update(...) }` in a declaration file). This
 * catches a client reached under a name the receiver options do not describe,
 * such as a repository base class's `this.client`.
 */
function resolvesToPrismaDelegate(declaration: ts.Declaration | undefined): boolean {
  const parent = declaration?.parent;
  return (
    parent !== undefined &&
    (ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent)) &&
    /Delegate$/u.test(parent.name.text)
  );
}

/** Last name of a receiver: `auditService` for both `auditService` and `this.auditService`. */
function receiverName(node: ts.Expression): string | null {
  const current = unwrap(node);
  if (ts.isIdentifier(current)) {
    return current.text;
  }
  if (ts.isPropertyAccessExpression(current)) {
    return current.name.text;
  }
  return null;
}

function hasBody(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)) &&
    node.body !== undefined
  );
}

function isLibraryFile(program: ts.Program, sourceFile: ts.SourceFile): boolean {
  return sourceFile.isDeclarationFile || program.isSourceFileFromExternalLibrary(sourceFile);
}

/** `Class.method`, `functionName`, or `<anonymous>@file:line` for a readable path. */
export function labelOf(node: ts.FunctionLikeDeclaration): string {
  const sourceFile = node.getSourceFile();
  const nameOf = (name: ts.Node | undefined): string | null =>
    name !== undefined && (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name))
      ? name.text
      : null;
  let own = nameOf(node.name);
  if (own === null && ts.isConstructorDeclaration(node)) {
    own = 'constructor';
  }
  if (
    own === null &&
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    (ts.isVariableDeclaration(node.parent) || ts.isPropertyDeclaration(node.parent))
  ) {
    own = nameOf(node.parent.name);
  }
  const owner =
    ts.isClassLike(node.parent) || ts.isPropertyDeclaration(node.parent)
      ? nameOf((ts.isClassLike(node.parent) ? node.parent : node.parent.parent).name)
      : null;
  if (own !== null) {
    return owner !== null ? `${owner}.${own}` : own;
  }
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return `<anonymous>@${baseName(sourceFile.fileName)}:${line + 1}`;
}

export function baseName(fileName: string): string {
  const parts = fileName.split(/[\\/]/u);
  return parts[parts.length - 1] ?? fileName;
}

/**
 * Where a resolved declaration leads: a body to walk, a library leaf, or
 * something with no body in project source (opaque).
 */
type Resolution =
  | { readonly kind: 'body'; readonly node: ts.FunctionLikeDeclaration }
  | { readonly kind: 'leaf' }
  | { readonly kind: 'opaque'; readonly reason: string };

function resolveDeclaration(
  program: ts.Program,
  declaration: ts.Node | undefined,
  symbol: ts.Symbol | undefined,
  text: string,
): Resolution {
  if (declaration === undefined) {
    return { kind: 'opaque', reason: `\`${text}\` does not resolve to a declaration` };
  }
  if (isLibraryFile(program, declaration.getSourceFile())) {
    return { kind: 'leaf' };
  }
  if (hasBody(declaration)) {
    return { kind: 'body', node: declaration };
  }
  // An overload signature: the implementation is a sibling declaration.
  const implementation = symbol?.declarations?.find(hasBody);
  if (implementation !== undefined) {
    return { kind: 'body', node: implementation };
  }
  return { kind: 'opaque', reason: `\`${text}\` has no body the walk can read` };
}

function shortText(node: ts.Node): string {
  const text = node.getText().replace(/\s+/gu, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

/** Collect a function body's direct writes, audits and resolved callees. */
function readBody(
  program: ts.Program,
  checker: ts.TypeChecker,
  fn: ts.FunctionLikeDeclaration,
  options: AuditGraphOptions,
): BodyFacts {
  const writes: WriteSite[] = [];
  const callees: ts.FunctionLikeDeclaration[] = [];
  let audits = false;
  let opaque: string | null = null;
  const sourceFile = fn.getSourceFile();

  const recordWrite = (node: ts.Node, model: string, method: string): void => {
    if (options.auditModels.has(model)) {
      audits = true;
      return;
    }
    if (options.unauditedModels.has(model)) {
      return;
    }
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    writes.push({ model, method, fileName: sourceFile.fileName, line: line + 1 });
  };

  const follow = (resolution: Resolution): void => {
    if (resolution.kind === 'body') {
      callees.push(resolution.node);
    } else if (resolution.kind === 'opaque' && opaque === null) {
      opaque = resolution.reason;
    }
  };

  /** A method reference handed over as a value (`.then(this.finish)`) is a call the walk follows too. */
  const followReference = (argument: ts.Expression): void => {
    const inner = unwrap(argument);
    if (!ts.isPropertyAccessExpression(inner) && !ts.isIdentifier(inner)) {
      return;
    }
    const symbol = checker.getSymbolAtLocation(inner);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    if (declaration !== undefined && !isLibraryFile(program, declaration.getSourceFile())) {
      const target = hasBody(declaration)
        ? declaration
        : (ts.isPropertyDeclaration(declaration) || ts.isVariableDeclaration(declaration)) &&
            declaration.initializer !== undefined &&
            hasBody(declaration.initializer)
          ? declaration.initializer
          : undefined;
      if (target !== undefined) {
        callees.push(target);
      }
    }
  };

  const visitCall = (call: ts.CallExpression): void => {
    const callee = unwrap(call.expression);
    if (callee.kind === ts.SyntaxKind.SuperKeyword || callee.kind === ts.SyntaxKind.ImportKeyword) {
      return;
    }
    call.arguments.forEach(followReference);

    if (ts.isPropertyAccessExpression(callee)) {
      const method = callee.name.text;
      const receiver = callee.expression;
      const receiverId = receiverName(receiver);
      if (
        options.auditMethods.has(method) &&
        receiverId !== null &&
        options.auditReceiverPattern.test(receiverId)
      ) {
        audits = true;
        return;
      }
      if (DELEGATE_METHODS.has(method)) {
        const signature = checker.getResolvedSignature(call);
        if (
          receiverLooksLikePrisma(receiver, options) ||
          resolvesToPrismaDelegate(signature?.getDeclaration())
        ) {
          if (WRITE_METHODS.has(method)) {
            recordWrite(call, receiverName(receiver) ?? '?', method);
          }
          return;
        }
      }
      if (method.startsWith('$') && receiverLooksLikePrisma(receiver, options)) {
        // `$transaction`, `$executeRaw`, `$connect`: client plumbing. The
        // callback a `$transaction` takes is walked as part of this body.
        return;
      }
    }

    const signature = checker.getResolvedSignature(call);
    const symbol = checker.getSymbolAtLocation(callee);
    follow(resolveDeclaration(program, signature?.getDeclaration(), symbol, shortText(callee)));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      visitCall(node);
    }
    ts.forEachChild(node, visit);
  };
  if (fn.body !== undefined) {
    visit(fn.body);
  }
  return { writes, audits, callees, opaque };
}

/**
 * One walker per program and option set. Body facts are cached per
 * declaration node, so a repository method reached from forty entry points is
 * read once; a new program (the next lint run, an edited file) brings new
 * nodes and so a fresh cache.
 */
export function createAuditGraph(program: ts.Program, options: AuditGraphOptions) {
  const checker = program.getTypeChecker();
  const facts = new WeakMap<ts.Node, BodyFacts>();

  const factsOf = (fn: ts.FunctionLikeDeclaration): BodyFacts => {
    let cached = facts.get(fn);
    if (cached === undefined) {
      cached = readBody(program, checker, fn, options);
      facts.set(fn, cached);
    }
    return cached;
  };

  /**
   * Breadth-first from the entry. The verdict is `unaudited` only when the
   * whole reachable graph was read, it holds a Prisma write, and it holds no
   * audit write: any unreadable edge or a graph deeper than `maxDepth` makes
   * it `opaque` instead, because the part not read might be the audit.
   */
  function verdictFor(entry: ts.FunctionLikeDeclaration): AuditGraphVerdict {
    const parent = new Map<ts.FunctionLikeDeclaration, ts.FunctionLikeDeclaration | null>([
      [entry, null],
    ]);
    let frontier: ts.FunctionLikeDeclaration[] = [entry];
    let firstWrite: { site: WriteSite; holder: ts.FunctionLikeDeclaration } | null = null;

    for (let depth = 0; frontier.length > 0; depth += 1) {
      const next: ts.FunctionLikeDeclaration[] = [];
      for (const fn of frontier) {
        const body = factsOf(fn);
        if (body.audits) {
          return { kind: 'audited' };
        }
        if (body.opaque !== null) {
          return { kind: 'opaque', reason: body.opaque };
        }
        const write = body.writes[0];
        if (firstWrite === null && write !== undefined) {
          firstWrite = { site: write, holder: fn };
        }
        for (const callee of body.callees) {
          if (!parent.has(callee)) {
            parent.set(callee, fn);
            next.push(callee);
          }
        }
      }
      if (next.length > 0 && depth + 1 > options.maxDepth) {
        return { kind: 'opaque', reason: `the call graph is deeper than maxDepth (${options.maxDepth})` };
      }
      frontier = next;
    }

    if (firstWrite === null) {
      return { kind: 'no-write' };
    }
    const path: string[] = [];
    for (
      let current: ts.FunctionLikeDeclaration | null | undefined = firstWrite.holder;
      current !== null && current !== undefined;
      current = parent.get(current)
    ) {
      path.unshift(labelOf(current));
    }
    return { kind: 'unaudited', write: firstWrite.site, path };
  }

  return { verdictFor };
}
