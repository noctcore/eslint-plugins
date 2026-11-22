import { AST_NODE_TYPES, type TSESTree } from '@noctcore/eslint-utils';

/** Module specifiers that export the three.js core classes. */
const THREE_CORE = new Set(['three', 'three/webgpu']);

/** Module specifiers whose exports are three.js add-ons (loaders, controls, helpers). */
function isThreeAddonSource(source: string): boolean {
  return (
    source.startsWith('three/addons') ||
    source.startsWith('three/examples/') ||
    source === 'three-stdlib' ||
    source.startsWith('three-stdlib/')
  );
}

const FIBER = '@react-three/fiber';

/** What a file imports from three.js and React Three Fiber, by local name. */
export interface ThreeImports {
  /** Local name to imported name, for named imports from `three` and `three/webgpu`. */
  readonly core: ReadonlyMap<string, string>;
  /** Local names of `import * as THREE from 'three'` (and default imports, which some bundlers allow). */
  readonly namespaces: ReadonlySet<string>;
  /** Local name to imported name, for named imports from add-on modules. */
  readonly addons: ReadonlyMap<string, string>;
  /** Local name to imported name, for named imports from `@react-three/fiber`. */
  readonly fiber: ReadonlyMap<string, string>;
}

function importedName(specifier: TSESTree.ImportSpecifier): string {
  return specifier.imported.type === AST_NODE_TYPES.Identifier
    ? specifier.imported.name
    : String(specifier.imported.value);
}

/** Reads the file's import declarations once. Type-only imports are ignored. */
export function readThreeImports(program: TSESTree.Program): ThreeImports {
  const core = new Map<string, string>();
  const namespaces = new Set<string>();
  const addons = new Map<string, string>();
  const fiber = new Map<string, string>();

  for (const statement of program.body) {
    if (statement.type !== AST_NODE_TYPES.ImportDeclaration || statement.importKind === 'type') {
      continue;
    }
    const source = statement.source.value;
    const isCore = THREE_CORE.has(source);
    const isAddon = isThreeAddonSource(source);
    const isFiber = source === FIBER;
    if (!isCore && !isAddon && !isFiber) continue;

    for (const specifier of statement.specifiers) {
      if (specifier.type === AST_NODE_TYPES.ImportSpecifier) {
        if (specifier.importKind === 'type') continue;
        const target = isCore ? core : isAddon ? addons : fiber;
        target.set(specifier.local.name, importedName(specifier));
      } else if (isCore) {
        namespaces.add(specifier.local.name);
      }
    }
  }

  return { core, namespaces, addons, fiber };
}

/**
 * The three.js core class a `new` expression constructs, or null: `Vector3` for
 * `new Vector3()` (imported from `three`) and `new THREE.Vector3()` (namespace
 * import). A local class that happens to share the name is not matched.
 */
export function threeCoreClass(node: TSESTree.NewExpression, imports: ThreeImports): string | null {
  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.Identifier) {
    return imports.core.get(callee.name) ?? null;
  }
  if (
    callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.object.type === AST_NODE_TYPES.Identifier &&
    imports.namespaces.has(callee.object.name) &&
    callee.property.type === AST_NODE_TYPES.Identifier
  ) {
    return callee.property.name;
  }
  return null;
}

/** The add-on class a `new` expression constructs (`new GLTFLoader()`), or null. */
export function threeAddonClass(node: TSESTree.NewExpression, imports: ThreeImports): string | null {
  return node.callee.type === AST_NODE_TYPES.Identifier
    ? (imports.addons.get(node.callee.name) ?? null)
    : null;
}

/**
 * Classes that hold GPU memory until `dispose()` is called: every geometry,
 * material and texture class, and render targets. Matched by suffix so new
 * subclasses (`CapsuleGeometry`, `MeshPhysicalMaterial`, `CubeTexture`) count.
 */
const GPU_RESOURCE = /(?:Geometry|Material|Texture|RenderTarget)$/u;

/** True for a three.js class whose instances hold GPU memory until disposed. */
export function isGpuResourceClass(name: string): boolean {
  return GPU_RESOURCE.test(name);
}

/** True for a loader class (`TextureLoader`, `GLTFLoader`). */
export function isLoaderClass(name: string): boolean {
  return name.endsWith('Loader');
}

/** The local name `@react-three/fiber`'s export `name` is bound to, or null. */
export function fiberLocal(imports: ThreeImports, name: string): string | null {
  for (const [local, imported] of imports.fiber) {
    if (imported === name) return local;
  }
  return null;
}

/** The `extraModules` schema entry the import-gated rules share. */
export const extraModulesSchema = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  uniqueItems: true,
  description:
    'More module specifiers that mark a file as three.js code, for a project that re-exports three.js through its own module (`@acme/engine`). A specifier also matches its subpaths. Empty by default.',
} as const;

function matchesModule(source: string, module: string): boolean {
  return source === module || source.startsWith(`${module}/`);
}

/**
 * True when the file imports `three`, any `three/*` subpath, `three-stdlib`, any
 * `@react-three/*` package, or one of `extraModules` (type-only and side-effect
 * imports count). Rules that match by name (`camera.fov`, `setPixelRatio`) run
 * only in such files, so a Phaser or Babylon camera is never read as a three.js one.
 */
export function isThreeFile(program: TSESTree.Program, extraModules: readonly string[] = []): boolean {
  return program.body.some((statement) => {
    if (statement.type !== AST_NODE_TYPES.ImportDeclaration) return false;
    const source = statement.source.value;
    return (
      matchesModule(source, 'three') ||
      matchesModule(source, 'three-stdlib') ||
      source.startsWith('@react-three/') ||
      extraModules.some((module) => matchesModule(source, module))
    );
  });
}
