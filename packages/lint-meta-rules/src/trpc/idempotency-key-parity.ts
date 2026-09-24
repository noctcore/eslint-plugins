import type { IMetaRule, IViolation } from '@noctcore/harness';

import { DEFAULT_SKIP_DIRS, escapeRegExp, globFiles, readSourceText } from '../rules/shared';

/**
 * Options for {@link createIdempotencyKeyParityRule}.
 *
 * Ported from Settly, which hardcoded the middleware (`IdempotencyMiddleware`),
 * the key (`idempotencyKey`) and the two trees (`apps/api/src` routers,
 * `apps/web/src` callers). Those are options; the decorator shape defaults to
 * `nestjs-trpc`'s (`@Router({ alias })`, `@UseMiddlewares(...)`) and the client
 * shape to a `trpc.<alias>.<method>` proxy. With no `middleware` the rule is inert.
 */
export interface IdempotencyKeyParityOptions {
  /** Rule id, for running more than one instance. Default `idempotency-key-parity`. */
  readonly id?: string;
  /** The middleware class that de-duplicates on a client-sent key. Unset or empty = inert. */
  readonly middleware?: string;
  /** Globs of the server router files. Default: none (inert). */
  readonly routerGlobs?: readonly string[];
  /** Globs of every client file that can call a procedure or send a key. Default: none. */
  readonly clientGlobs?: readonly string[];
  /** The token a client file must mention to count as sending a key. Default `idempotencyKey`. */
  readonly keyToken?: string;
  /** What precedes `<alias>.<method>` at a client call site. Default `trpc.`. */
  readonly clientPrefix?: string;
  /** The class decorator that names the router. Default `Router`. */
  readonly routerDecorator?: string;
  /** The key in that decorator's object argument holding the router's alias. Default `alias`. */
  readonly aliasKey?: string;
  /** The method decorator listing a procedure's middlewares. Default `UseMiddlewares`. */
  readonly middlewareDecorator?: string;
  /**
   * `<alias>.<method>` procedures whose caller deliberately sends no key. Keep
   * it empty: the honest fix for "a key will never be sent here" is to drop the
   * middleware. Default: none.
   */
  readonly exempt?: readonly string[];
  /** Paths with any of these segments are skipped. Default `node_modules`, `.git`, `dist`, `.turbo`, `coverage`. */
  readonly skipDirs?: readonly string[];
  /** Appended to every message: how this project threads the key. */
  readonly hint?: string;
  /** Whether a violation fails CI. Default `true`. */
  readonly ciCritical?: boolean;
}

const DEFAULT_ID = 'idempotency-key-parity';

interface ParsedNames {
  readonly alias: RegExp;
  readonly decorator: RegExp;
  readonly middleware: RegExp;
}

/** `@<Router>({ ..., alias: 'x' })` on the class, or null when the file has none. */
function routerAlias(source: string, names: ParsedNames): string | null {
  return names.alias.exec(source)?.[2] ?? null;
}

/**
 * The method names decorated with a middleware list that includes the
 * middleware: read from the decorator to the next `async <name>(`.
 */
function guardedMethods(source: string, names: ParsedNames): string[] {
  const methods: string[] = [];
  const decorator = new RegExp(names.decorator.source, 'gu');
  let match: RegExpExecArray | null;
  while ((match = decorator.exec(source)) !== null) {
    if (!names.middleware.test(match[1] ?? '')) continue;
    const rest = source.slice(match.index + match[0].length);
    const method = /\basync\s+([A-Za-z_$][\w$]*)\s*\(/u.exec(rest)?.[1];
    if (method !== undefined) methods.push(method);
  }
  return methods;
}

/**
 * Every idempotency-guarded procedure has a client caller that sends a key, or
 * no client caller at all.
 *
 * The middleware only de-duplicates when the client sends a key, and neither
 * half fails when the other is missing: the server passes the request through,
 * the client gets a normal response, and both test suites pass. A guard nobody
 * sends a key to is decoration advertising double-submit protection that does
 * not exist. The rule holds the two lists side by side. A procedure with no
 * client caller passes: the guard is correct in advance of the screen that will
 * use it. The reverse (a key sent to an unguarded procedure) is inert and needs
 * no rule.
 */
export function createIdempotencyKeyParityRule(options: IdempotencyKeyParityOptions = {}): IMetaRule {
  const id = options.id ?? DEFAULT_ID;
  const middleware = options.middleware ?? '';
  const keyToken = options.keyToken ?? 'idempotencyKey';
  const clientPrefix = options.clientPrefix ?? 'trpc.';
  const skipDirs = options.skipDirs ?? DEFAULT_SKIP_DIRS;
  const exempt = new Set(options.exempt ?? []);
  const names: ParsedNames = {
    alias: new RegExp(
      `@${escapeRegExp(options.routerDecorator ?? 'Router')}\\(\\{[^}]*\\b${escapeRegExp(options.aliasKey ?? 'alias')}:\\s*(['"])([^'"]+)\\1`,
      'u',
    ),
    decorator: new RegExp(`@${escapeRegExp(options.middlewareDecorator ?? 'UseMiddlewares')}\\(([^)]*)\\)`, 'u'),
    middleware: new RegExp(`\\b${escapeRegExp(middleware)}\\b`, 'u'),
  };

  return {
    id,
    category: 'source-text',
    ciCritical: options.ciCritical ?? true,
    description:
      'Procedures carrying the idempotency middleware must have a client caller that sends an idempotency key, or no client caller at all.',
    run(ctx) {
      if (middleware === '') return [];
      const clientSources = globFiles(ctx.glob, options.clientGlobs ?? [], skipDirs)
        .map((file) => readSourceText(ctx.read, file))
        .filter((text): text is string => text !== null);

      const violations: IViolation[] = [];
      for (const file of globFiles(ctx.glob, options.routerGlobs ?? [], skipDirs)) {
        const source = readSourceText(ctx.read, file);
        if (source === null || !names.middleware.test(source)) continue;

        const alias = routerAlias(source, names);
        if (alias === null) continue;

        for (const method of guardedMethods(source, names)) {
          const path = `${alias}.${method}`;
          if (exempt.has(path)) continue;

          const callers = clientSources.filter((text) => text.includes(`${clientPrefix}${path}`));
          // No client caller yet: the guard is correct in advance of its screen.
          if (callers.length === 0) continue;
          if (callers.some((text) => text.includes(keyToken))) continue;

          violations.push({
            file,
            rule: id,
            message: `\`${path}\` carries ${middleware} but its client callers never send \`${keyToken}\`, so the guard is inert. Send the key from the caller, or drop the middleware and say why.${
              options.hint === undefined || options.hint === '' ? '' : ` ${options.hint}`
            }`,
          });
        }
      }
      return violations;
    },
  };
}
