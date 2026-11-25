import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@noctcore/eslint-utils';

/*
 * How a file names the `path` and `fs` modules, and which calls take a
 * filesystem path. Without type information a module is known by how it was
 * loaded: a static import, `require`, a dynamic `import()` (awaited or not),
 * `import x = require(...)`, or an alias of one of those
 * (`const p = fs.promises`, `const { readFile } = fs`). Bindings made inside a
 * function count too (`const { readFile } = await import('node:fs')` in a
 * handler). Names are collected per file, not per scope: a local that shadows
 * one of these names is read as the module, which can only add reports.
 */

const PATH_MODULES: ReadonlySet<string> = new Set(['path', 'node:path']);
const FS_MODULES: ReadonlySet<string> = new Set([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'fs-extra',
  'fs-extra/esm',
]);
/** Receivers that are the fs module by convention, when no import says so. */
const CONVENTIONAL_FS: readonly string[] = ['fs', 'fsp', 'fsPromises'];
/** Path functions this rule reads by name. */
const PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'join',
  'resolve',
  'normalize',
  'basename',
  'extname',
  'relative',
  'isAbsolute',
  'sep',
]);

/** fs functions whose first argument is a path; the callback, sync and promise forms share a name. */
export const FS_PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'readFile',
  'readFileSync',
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'unlink',
  'unlinkSync',
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'mkdir',
  'mkdirSync',
  'mkdtemp',
  'mkdtempSync',
  'readdir',
  'readdirSync',
  'stat',
  'statSync',
  'lstat',
  'lstatSync',
  'statfs',
  'statfsSync',
  'exists',
  'existsSync',
  'open',
  'openSync',
  'openAsBlob',
  'opendir',
  'opendirSync',
  'access',
  'accessSync',
  'truncate',
  'truncateSync',
  'chmod',
  'chmodSync',
  'lchmod',
  'lchmodSync',
  'chown',
  'chownSync',
  'lchown',
  'lchownSync',
  'utimes',
  'utimesSync',
  'lutimes',
  'lutimesSync',
  'createReadStream',
  'createWriteStream',
  'readlink',
  'readlinkSync',
  'realpath',
  'realpathSync',
  'watch',
  'watchFile',
  'unwatchFile',
  'glob',
  'globSync',
]);
/** fs functions with a second path argument (source and destination). */
export const FS_TWO_PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'link',
  'linkSync',
  'symlink',
  'symlinkSync',
]);
/** `fs-extra` functions whose first argument is a path, beside the ones it re-exports from `fs`. */
const FS_EXTRA_PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'emptyDir',
  'emptyDirSync',
  'emptydir',
  'emptydirSync',
  'ensureDir',
  'ensureDirSync',
  'mkdirp',
  'mkdirpSync',
  'mkdirs',
  'mkdirsSync',
  'ensureFile',
  'ensureFileSync',
  'createFile',
  'createFileSync',
  'outputFile',
  'outputFileSync',
  'outputJson',
  'outputJsonSync',
  'outputJSON',
  'outputJSONSync',
  'pathExists',
  'pathExistsSync',
  'readJson',
  'readJsonSync',
  'readJSON',
  'readJSONSync',
  'writeJson',
  'writeJsonSync',
  'writeJSON',
  'writeJSONSync',
  'remove',
  'removeSync',
]);
/** `fs-extra` functions with a second path argument. */
const FS_EXTRA_TWO_PATH_FUNCTIONS: ReadonlySet<string> = new Set([
  'copy',
  'copySync',
  'move',
  'moveSync',
  'ensureLink',
  'ensureLinkSync',
  'createLink',
  'createLinkSync',
  'ensureSymlink',
  'ensureSymlinkSync',
  'createSymlink',
  'createSymlinkSync',
]);
/**
 * Functions that act on a directory as well as a file: removing, emptying,
 * listing, copying, moving, changing the mode of or linking `..` or the base
 * itself does damage, so a path segment must be refused as empty there too
 * (`basename('')` and `basename('/')` are `''`, and `join(base, '')` is the base).
 */
const DIRECTORY_FUNCTIONS: ReadonlySet<string> = new Set([
  'rm',
  'rmSync',
  'rmdir',
  'rmdirSync',
  'readdir',
  'readdirSync',
  'opendir',
  'opendirSync',
  'cp',
  'cpSync',
  'rename',
  'renameSync',
  'chmod',
  'chmodSync',
  'lchmod',
  'lchmodSync',
  'chown',
  'chownSync',
  'lchown',
  'lchownSync',
  'symlink',
  'symlinkSync',
  'emptyDir',
  'emptyDirSync',
  'emptydir',
  'emptydirSync',
  'remove',
  'removeSync',
  'copy',
  'copySync',
  'move',
  'moveSync',
  'ensureSymlink',
  'ensureSymlinkSync',
  'createSymlink',
  'createSymlinkSync',
]);

/** True for an fs function that acts on a directory too (`rm`, `readdir`, `cp`, fs-extra `remove`). */
export function actsOnDirectory(method: string): boolean {
  return DIRECTORY_FUNCTIONS.has(method);
}

function isOnePathFunction(name: string): boolean {
  return FS_PATH_FUNCTIONS.has(name) || FS_EXTRA_PATH_FUNCTIONS.has(name);
}

function isTwoPathFunction(name: string): boolean {
  return FS_TWO_PATH_FUNCTIONS.has(name) || FS_EXTRA_TWO_PATH_FUNCTIONS.has(name);
}
/** Response methods that serve a file from disk (Express, and `@fastify/static` on `reply`). */
const RESPONSE_FILE_METHODS: ReadonlySet<string> = new Set(['sendFile', 'download']);
const RESPONSE_OBJECTS: ReadonlySet<string> = new Set(['res', 'response']);
const FASTIFY_REPLY_OBJECTS: ReadonlySet<string> = new Set(['reply']);

export interface PathBindings {
  /** Local names of the `path` module. */
  readonly modules: Set<string>;
  /** Local name of a function imported from `path` (`join`, `basename`, `sep`) to its imported name. */
  readonly pathFunctions: Map<string, string>;
  /** Local names of the fs module (`fs`, `fsp`, `const fs = require('node:fs')`). */
  readonly fsModules: Set<string>;
  /** Local name of an imported fs function to its imported name. */
  readonly fsFunctions: Map<string, string>;
}

/** Peels type wrappers, `await` and optional chains, which keep the value. */
export function peel(node: TSESTree.Node): TSESTree.Node {
  let current = node;
  for (;;) {
    if (
      current.type === AST_NODE_TYPES.TSAsExpression ||
      current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
      current.type === AST_NODE_TYPES.TSNonNullExpression ||
      current.type === AST_NODE_TYPES.TSTypeAssertion ||
      current.type === AST_NODE_TYPES.ChainExpression
    ) {
      current = current.expression;
    } else if (current.type === AST_NODE_TYPES.AwaitExpression) {
      current = current.argument;
    } else {
      return current;
    }
  }
}

/** The name a member step reads (`x.y`, `x['y']`), or null for a dynamic key. */
export function propertyName(member: TSESTree.MemberExpression): string | null {
  if (!member.computed && member.property.type === AST_NODE_TYPES.Identifier) {
    return member.property.name;
  }
  return member.property.type === AST_NODE_TYPES.Literal && typeof member.property.value === 'string'
    ? member.property.value
    : null;
}

/** The module a `require('<name>')` or `import('<name>')` call loads, else null. */
function loadedModule(node: TSESTree.Node): string | null {
  const inner = peel(node);
  if (
    inner.type === AST_NODE_TYPES.ImportExpression &&
    inner.source.type === AST_NODE_TYPES.Literal &&
    typeof inner.source.value === 'string'
  ) {
    return inner.source.value;
  }
  if (
    inner.type === AST_NODE_TYPES.CallExpression &&
    inner.callee.type === AST_NODE_TYPES.Identifier &&
    inner.callee.name === 'require' &&
    inner.arguments[0]?.type === AST_NODE_TYPES.Literal &&
    typeof inner.arguments[0].value === 'string'
  ) {
    return inner.arguments[0].value;
  }
  return null;
}

/** Which module an expression is: `fs`, `path`, or neither. */
export function moduleKind(node: TSESTree.Node, bindings: PathBindings): 'fs' | 'path' | null {
  const inner = peel(node);
  const loaded = loadedModule(inner);
  if (loaded !== null) {
    return FS_MODULES.has(loaded) ? 'fs' : PATH_MODULES.has(loaded) ? 'path' : null;
  }
  if (inner.type === AST_NODE_TYPES.Identifier) {
    return bindings.fsModules.has(inner.name)
      ? 'fs'
      : bindings.modules.has(inner.name)
        ? 'path'
        : null;
  }
  if (inner.type === AST_NODE_TYPES.MemberExpression) {
    const name = propertyName(inner);
    const owner = moduleKind(inner.object, bindings);
    // `fs.promises`, `(await import('node:fs')).default`.
    if (owner === 'fs' && (name === 'promises' || name === 'default')) {
      return 'fs';
    }
    if (owner === 'path' && name === 'default') {
      return 'path';
    }
  }
  return null;
}

/** Records the names a destructuring of a module binds (`const { readFile: rf } = fs`). */
function collectPattern(
  pattern: TSESTree.ObjectPattern,
  kind: 'fs' | 'path',
  bindings: PathBindings,
): void {
  for (const property of pattern.properties) {
    if (property.type !== AST_NODE_TYPES.Property) {
      continue;
    }
    const imported =
      !property.computed && property.key.type === AST_NODE_TYPES.Identifier
        ? property.key.name
        : property.key.type === AST_NODE_TYPES.Literal && typeof property.key.value === 'string'
          ? property.key.value
          : null;
    const value =
      property.value.type === AST_NODE_TYPES.AssignmentPattern ? property.value.left : property.value;
    if (imported === null) {
      continue;
    }
    // `const { promises: { readFile } } = require('fs')`, `{ default: { join } }`.
    if (value.type === AST_NODE_TYPES.ObjectPattern) {
      if (imported === 'default' || (kind === 'fs' && imported === 'promises')) {
        collectPattern(value, kind, bindings);
      }
      continue;
    }
    if (value.type !== AST_NODE_TYPES.Identifier) {
      continue;
    }
    addName(value.name, imported, kind, bindings);
  }
}

function addName(local: string, imported: string, kind: 'fs' | 'path', bindings: PathBindings): void {
  if (kind === 'fs') {
    if (imported === 'promises' || imported === 'default') {
      bindings.fsModules.add(local);
    } else if (isOnePathFunction(imported) || isTwoPathFunction(imported)) {
      bindings.fsFunctions.set(local, imported);
    }
  } else if (imported === 'default') {
    bindings.modules.add(local);
  } else if (PATH_FUNCTIONS.has(imported)) {
    bindings.pathFunctions.set(local, imported);
  }
}

/** Records `const x = <module>` and `const { f } = <module>`; true when it added a name. */
function collectDeclarator(declarator: TSESTree.VariableDeclarator, bindings: PathBindings): boolean {
  if (declarator.init === null) {
    return false;
  }
  const kind = moduleKind(declarator.init, bindings);
  if (kind === null) {
    return false;
  }
  const before = bindings.modules.size + bindings.fsModules.size + bindings.fsFunctions.size;
  const pathBefore = bindings.pathFunctions.size;
  if (declarator.id.type === AST_NODE_TYPES.Identifier) {
    (kind === 'fs' ? bindings.fsModules : bindings.modules).add(declarator.id.name);
  } else if (declarator.id.type === AST_NODE_TYPES.ObjectPattern) {
    collectPattern(declarator.id, kind, bindings);
  }
  return (
    bindings.modules.size + bindings.fsModules.size + bindings.fsFunctions.size !== before ||
    bindings.pathFunctions.size !== pathBefore
  );
}

function collectImport(statement: TSESTree.ImportDeclaration, bindings: PathBindings): void {
  const source = statement.source.value;
  const kind = FS_MODULES.has(source) ? 'fs' : PATH_MODULES.has(source) ? 'path' : null;
  if (kind === null || statement.importKind === 'type') {
    return;
  }
  for (const specifier of statement.specifiers) {
    if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
      const imported =
        specifier.imported.type === AST_NODE_TYPES.Identifier
          ? specifier.imported.name
          : specifier.imported.value;
      addName(specifier.local.name, imported, kind, bindings);
    } else {
      (kind === 'fs' ? bindings.fsModules : bindings.modules).add(specifier.local.name);
    }
  }
}

/** Collects how this file names the `path` and `fs` modules and their functions. */
export function collectPathBindings(
  program: TSESTree.Program,
  visitorKeys: TSESLint.SourceCode.VisitorKeys,
): PathBindings {
  const bindings: PathBindings = {
    modules: new Set(['path']),
    pathFunctions: new Map(),
    fsModules: new Set(CONVENTIONAL_FS),
    fsFunctions: new Map(),
  };
  const declarators: TSESTree.VariableDeclarator[] = [];
  const stack: TSESTree.Node[] = [program];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.type === AST_NODE_TYPES.ImportDeclaration) {
      collectImport(node, bindings);
      continue;
    }
    if (
      node.type === AST_NODE_TYPES.TSImportEqualsDeclaration &&
      node.moduleReference.type === AST_NODE_TYPES.TSExternalModuleReference &&
      node.moduleReference.expression.type === AST_NODE_TYPES.Literal &&
      typeof node.moduleReference.expression.value === 'string'
    ) {
      const source = node.moduleReference.expression.value;
      if (FS_MODULES.has(source)) bindings.fsModules.add(node.id.name);
      if (PATH_MODULES.has(source)) bindings.modules.add(node.id.name);
      continue;
    }
    if (node.type === AST_NODE_TYPES.VariableDeclarator) {
      declarators.push(node);
    }
    for (const key of visitorKeys[node.type] ?? []) {
      const value: unknown = Reflect.get(node, key);
      for (const child of Array.isArray(value) ? value : [value]) {
        if (typeof child === 'object' && child !== null && 'type' in child) {
          stack.push(child as TSESTree.Node);
        }
      }
    }
  }
  // Aliases of aliases (`const p = fs.promises; const { readFile } = p`), in any order.
  for (let changed = true, round = 0; changed && round < 8; round += 1) {
    changed = false;
    for (const declarator of declarators) {
      changed = collectDeclarator(declarator, bindings) || changed;
    }
  }
  return bindings;
}

/** The `path` function a callee names (`path.join`, an imported `join`), or null. */
export function pathFunction(callee: TSESTree.Node, bindings: PathBindings): string | null {
  const inner = peel(callee);
  if (inner.type === AST_NODE_TYPES.Identifier) {
    return bindings.pathFunctions.get(inner.name) ?? null;
  }
  if (inner.type !== AST_NODE_TYPES.MemberExpression || moduleKind(inner.object, bindings) !== 'path') {
    return null;
  }
  const name = propertyName(inner);
  return name !== null && PATH_FUNCTIONS.has(name) ? name : null;
}

/** True for `sep` from `path` (`path.sep`, an imported `sep`). */
export function isPathSep(node: TSESTree.Node, bindings: PathBindings): boolean {
  const inner = peel(node);
  if (inner.type === AST_NODE_TYPES.Identifier) {
    return bindings.pathFunctions.get(inner.name) === 'sep';
  }
  return (
    inner.type === AST_NODE_TYPES.MemberExpression &&
    propertyName(inner) === 'sep' &&
    moduleKind(inner.object, bindings) === 'path'
  );
}

/** The fs function a callee names (`fs.readFile`, `fs.promises.rm`, an imported `unlink`), or null. */
export function fsFunction(callee: TSESTree.Node, bindings: PathBindings): string | null {
  const inner = peel(callee);
  if (inner.type === AST_NODE_TYPES.Identifier) {
    return bindings.fsFunctions.get(inner.name) ?? null;
  }
  if (inner.type !== AST_NODE_TYPES.MemberExpression || moduleKind(inner.object, bindings) !== 'fs') {
    return null;
  }
  const name = propertyName(inner);
  return name !== null && (isOnePathFunction(name) || isTwoPathFunction(name)) ? name : null;
}

/**
 * The values that may set `root` in an options object literal, in order: the
 * `root` property, and every spread or computed key written after it (any of
 * which can set `root` again, `{ root: DIR, ...req.body }`). `explicit` is
 * true when a `root` property is among them. Empty for anything else.
 */
function rootValues(node: TSESTree.Node | undefined): { values: TSESTree.Node[]; explicit: boolean } {
  const inner = node === undefined ? null : peel(node);
  if (inner?.type !== AST_NODE_TYPES.ObjectExpression) {
    return { values: [], explicit: false };
  }
  let values: TSESTree.Node[] = [];
  let explicit = false;
  for (const property of inner.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      values.push(property.argument);
      continue;
    }
    const key = property.key;
    const literalKey = key.type === AST_NODE_TYPES.Literal ? key.value : undefined;
    if (
      literalKey === 'root' ||
      (!property.computed && key.type === AST_NODE_TYPES.Identifier && key.name === 'root')
    ) {
      values = [property.value];
      explicit = true;
    } else if (property.computed && literalKey === undefined && key.type !== AST_NODE_TYPES.TemplateLiteral) {
      // A computed key the rule cannot read may be `root`.
      values.push(property.value);
    }
  }
  return { values, explicit };
}

/**
 * The roots a Fastify `reply.sendFile` / `reply.download` call passes, which
 * override the root registered with `@fastify/static`:
 * `reply.sendFile(f, rootPath)`, `reply.sendFile(f, { root })`,
 * `reply.sendFile(f, rootPath, opts)`, `reply.download(f, { root })` and
 * `reply.download(f, name, { root })`, plus whatever a spread into the
 * options can set it to.
 */
function fastifyRoots(method: string, args: readonly TSESTree.Expression[]): TSESTree.Node[] {
  const roots: TSESTree.Node[] = [];
  const second = args[1];
  if (method === 'sendFile' && second !== undefined && peel(second).type !== AST_NODE_TYPES.ObjectExpression) {
    // A string root, or a value this rule cannot tell from an options object.
    roots.push(second);
  }
  for (const arg of args.slice(1)) {
    for (const root of rootValues(arg).values) {
      if (!roots.includes(root)) roots.push(root);
    }
  }
  return roots;
}

/**
 * The arguments of a call by position: an array literal spread in place
 * (`f(...[a, b])` is `f(a, b)`), and any other spread as the next position,
 * after which positions are unknown.
 */
function positionalArguments(args: readonly TSESTree.CallExpressionArgument[]): TSESTree.Expression[] {
  const result: TSESTree.Expression[] = [];
  for (const arg of args) {
    if (arg.type !== AST_NODE_TYPES.SpreadElement) {
      result.push(arg);
      continue;
    }
    const inner = peel(arg.argument);
    if (
      inner.type === AST_NODE_TYPES.ArrayExpression &&
      inner.elements.every((element) => element !== null && element.type !== AST_NODE_TYPES.SpreadElement)
    ) {
      result.push(...(inner.elements as TSESTree.Expression[]));
      continue;
    }
    return [...result, arg.argument];
  }
  return result;
}

/**
 * The path arguments of a filesystem call, with the name to report: an fs
 * function on an fs module or imported by name (`fs-extra` included),
 * Express's `res.sendFile` / `res.download`, or Fastify's `reply.sendFile` /
 * `reply.download`. With a `root` option, Express (through `send`) refuses a
 * path with a `..` segment after decoding it and serves it under the root, so
 * the root is the path that matters there. `@fastify/static` always serves
 * under a root (the one registered with the plugin, or one the call passes)
 * and refuses `..` segments, so only a root the call passes is checked. A
 * spread or unreadable computed key in the options may set the root too, so
 * its value is checked like one. `confines` maps each root to the file
 * argument it serves under it, which matters when the root does not confine
 * anything (`'/'`, `''`, an unset environment variable). `isResponse` also
 * takes a receiver under another name as Express's response (a handler's
 * response parameter). Empty for any other call.
 */
export function fsPathArguments(
  node: TSESTree.CallExpression,
  bindings: PathBindings,
  isResponse?: (receiver: TSESTree.Identifier) => boolean,
): { method: string; paths: TSESTree.Node[]; confines: Map<TSESTree.Node, TSESTree.Node> } {
  const none = { method: '', paths: [], confines: new Map<TSESTree.Node, TSESTree.Node>() };
  const fsName = fsFunction(node.callee, bindings);
  const args = positionalArguments(node.arguments);
  if (fsName !== null) {
    return { ...none, method: fsName, paths: args.slice(0, isTwoPathFunction(fsName) ? 2 : 1) };
  }
  const callee = peel(node.callee);
  if (callee.type !== AST_NODE_TYPES.MemberExpression || callee.object.type !== AST_NODE_TYPES.Identifier) {
    return none;
  }
  const name = propertyName(callee);
  if (name === null || !RESPONSE_FILE_METHODS.has(name)) {
    return none;
  }
  const method = `${callee.object.name}.${name}`;
  const file = args[0];
  const confining = (roots: TSESTree.Node[]): Map<TSESTree.Node, TSESTree.Node> =>
    new Map(file === undefined ? [] : roots.map((root) => [root, file]));
  if (FASTIFY_REPLY_OBJECTS.has(callee.object.name)) {
    const roots = fastifyRoots(name, args);
    return { method, paths: roots, confines: confining(roots) };
  }
  if (!RESPONSE_OBJECTS.has(callee.object.name) && isResponse?.(callee.object) !== true) {
    return none;
  }
  const options = args.slice(1).map(rootValues);
  const roots = options.flatMap((option) => option.values);
  if (roots.length === 0) {
    return { ...none, method, paths: args.slice(0, 1) };
  }
  // Without a `root` property, a spread may leave the root unset: the file path is served as is.
  const paths = options.some((option) => option.explicit) ? roots : [...args.slice(0, 1), ...roots];
  return { method, paths, confines: confining(roots) };
}
