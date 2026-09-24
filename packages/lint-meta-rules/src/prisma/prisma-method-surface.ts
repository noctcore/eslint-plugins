import type { IMetaCtx, IMetaRule, IViolation } from '@noctcore/harness';
import { PRISMA_READ_METHODS, PRISMA_WRITE_METHODS } from '@noctcore/eslint-plugin-prisma';

import { globFiles } from '../rules/shared';

/**
 * Options for {@link createPrismaMethodSurfaceRule}.
 *
 * Every path is relative to the repo root the harness runs in.
 */
export interface PrismaMethodSurfaceOptions {
  /** Rule id, for running more than one instance. Default `prisma-method-surface`. */
  readonly id?: string;
  /**
   * Globs of the GENERATED Prisma client files that declare the
   * `<Model>Delegate` interfaces. Default: the `prisma-client` generator's
   * per-model files under `generated/prisma/models/`, and the
   * `prisma-client-js` generator's `node_modules/.prisma/client/index.d.ts`.
   */
  readonly clientGlobs?: readonly string[];
  /**
   * The methods your rules police as WRITES. Default: `PRISMA_WRITE_METHODS`
   * from `@noctcore/eslint-plugin-prisma`, which is what its rules read.
   */
  readonly writeMethods?: readonly string[];
  /**
   * The methods your rules know to be READS. Default: `PRISMA_READ_METHODS`
   * from `@noctcore/eslint-plugin-prisma`.
   */
  readonly readMethods?: readonly string[];
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'prisma-method-surface';
const DEFAULT_CLIENT_GLOBS = [
  'generated/prisma/models/*.ts',
  'node_modules/.prisma/client/index.d.ts',
];

/** One `<Model>Delegate` interface: where it was read, and its query methods. */
export interface DelegateSurface {
  readonly file: string;
  readonly model: string;
  readonly methods: readonly string[];
}

/**
 * Blank block and line comments, keeping line breaks so line structure survives.
 * Block comments are found with `indexOf`, not a lazy regex, so an unclosed
 * `/*` costs one pass instead of a rescan from every later `/*`.
 */
function blankComments(source: string): string {
  let out = '';
  let from = 0;
  for (let open = source.indexOf('/*'); open !== -1; open = source.indexOf('/*', from)) {
    const close = source.indexOf('*/', open + 2);
    if (close === -1) break;
    out += source.slice(from, open) + source.slice(open, close + 2).replace(/[^\n]/gu, ' ');
    from = close + 2;
  }
  return (out + source.slice(from)).replace(/(^|[^:])\/\/.*$/gmu, '$1');
}

/**
 * Every `<Model>Delegate` interface declared in `source`, with its query methods.
 *
 * A delegate member is a generic method, `name<T ...>(...)`, declared at the
 * interface's member indentation, one per line. That holds for both Prisma
 * generators, so a line scan is enough and needs no TypeScript parse. Anything
 * that is not a generic method (`fields`, the `[K: symbol]` brand) is not a
 * query method and is dropped, as is anything `$`-prefixed.
 */
export function parseDelegateSurfaces(source: string, file = ''): DelegateSurface[] {
  const lines = blankComments(source).split('\n');
  const surfaces: DelegateSurface[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)(?:export\s+)?interface\s+([A-Za-z_]\w*)Delegate\b.*\{\s*$/u.exec(
      lines[i] ?? '',
    );
    if (open?.[2] === undefined) continue;
    const indent = open[1] ?? '';

    let memberIndent: string | null = null;
    const methods = new Set<string>();
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j] ?? '';
      if (line.startsWith(`${indent}}`)) break;
      if (line.trim() === '') continue;
      const leading = /^\s*/u.exec(line)?.[0] ?? '';
      memberIndent ??= leading;
      if (leading !== memberIndent) continue;
      const member = /^\s*([A-Za-z_]\w*)\s*</u.exec(line);
      if (member?.[1] !== undefined) methods.add(member[1]);
    }
    surfaces.push({ file, model: open[2], methods: [...methods].sort() });
    i = j;
  }

  return surfaces;
}

const sorted = (values: Iterable<string>): string[] => [...values].sort();

/**
 * The model-delegate method surface the rules police must be the surface the
 * generated Prisma client actually exposes.
 *
 * Rules that guard Prisma calls by method name read a hand-written list, and a
 * list falls behind the client: Prisma adds a method, nobody edits the list, and
 * the new method is invisible to every fence at once. This reads the GENERATED
 * client's `<Model>Delegate` interfaces and asserts the configured reads and
 * writes partition them exactly, so an upgrade that adds a method turns CI red
 * instead of silently widening an unguarded surface.
 *
 * Fails closed: no generated client is a violation, never a vacuous pass, since
 * a checkout that never ran `prisma generate` is exactly where drift hides.
 */
export function createPrismaMethodSurfaceRule(options: PrismaMethodSurfaceOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const clientGlobs = options.clientGlobs ?? DEFAULT_CLIENT_GLOBS;
  const writeMethods = options.writeMethods ?? PRISMA_WRITE_METHODS;
  const readMethods = options.readMethods ?? PRISMA_READ_METHODS;

  return {
    id,
    category: 'config',
    ciCritical: options.ciCritical ?? true,
    description:
      "The Prisma reads and writes the rules police partition the generated client's <Model>Delegate method surface exactly, so a Prisma upgrade cannot add an unguarded method.",
    run(ctx: IMetaCtx) {
      const violations: IViolation[] = [];
      const report = (file: string, message: string): void => {
        violations.push({ file, rule: id, message });
      };
      const listFile = clientGlobs[0] ?? '<clientGlobs>';

      const writes = new Set(writeMethods);
      for (const method of readMethods) {
        if (writes.has(method)) {
          report(listFile, `"${method}" is configured as both a read and a write. Each delegate method belongs to exactly one.`);
        }
      }

      const surfaces = globFiles((pattern) => ctx.glob(pattern), clientGlobs).flatMap((file) =>
        parseDelegateSurfaces(ctx.read(file) ?? '', file),
      ).filter((surface) => surface.methods.length > 0);

      const [reference] = surfaces;
      if (reference === undefined) {
        report(
          listFile,
          `No generated Prisma client found under ${clientGlobs.map((glob) => `"${glob}"`).join(', ')}, so the method surface cannot be checked. Run \`prisma generate\` before lint-meta, or point \`clientGlobs\` at the generator's output.`,
        );
        return violations;
      }

      // The configured sets are model-agnostic, so a per-model difference would
      // make the comparison below true only for whichever delegate came first.
      const referenceKey = reference.methods.join(',');
      for (const surface of surfaces) {
        if (surface.methods.join(',') !== referenceKey) {
          report(
            surface.file,
            `${surface.model}Delegate exposes [${surface.methods.join(', ')}], which differs from ${reference.model}Delegate's [${reference.methods.join(', ')}]. The method lists are model-agnostic, so they cannot describe both.`,
          );
        }
      }

      const configured = new Set([...writeMethods, ...readMethods]);
      const actual = new Set(reference.methods);
      const unguarded = sorted(reference.methods.filter((method) => !configured.has(method)));
      const phantom = sorted([...configured].filter((method) => !actual.has(method)));

      if (unguarded.length > 0) {
        report(
          reference.file,
          `The generated client exposes ${unguarded.map((m) => `"${m}"`).join(', ')}, which is neither a configured read nor a configured write, so every rule guarding Prisma calls by method name misses it. Classify it in \`writeMethods\` or \`readMethods\` (and in the rules that read those lists).`,
        );
      }
      if (phantom.length > 0) {
        report(
          reference.file,
          `${phantom.map((m) => `"${m}"`).join(', ')} is configured but the generated client no longer exposes it. Drop it from the lists, or check the client was regenerated for this Prisma version.`,
        );
      }

      return violations;
    },
  };
}
