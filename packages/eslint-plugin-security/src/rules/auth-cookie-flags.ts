import { AST_NODE_TYPES, type TSESLint, type TSESTree } from '@noctcore/eslint-utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { matchesVocabulary, type SourceVocabulary, toVocabulary, unwrapExpression } from '../utils';

const RULE_NAME = 'auth-cookie-flags';

export type CookieFlag = 'httpOnly' | 'secure' | 'sameSite';

export interface AuthCookieFlagsOptions {
  readonly require?: readonly CookieFlag[];
  readonly authCookieNames?: readonly string[];
  readonly authCookiePattern?: string;
  readonly trustedConfigNames?: readonly string[];
}

type RuleOptions = [AuthCookieFlagsOptions];
type MessageIds = 'missingFlag' | 'weakFlag' | 'sameSiteNoneNeedsSecure';

/** Fixed check and report order, whatever order `require` lists them in. */
const FLAGS: readonly CookieFlag[] = ['httpOnly', 'secure', 'sameSite'];
const DEFAULT_AUTH_COOKIE_NAMES: readonly string[] = ['auth_token', 'session', 'sid', 'authToken'];
const SAME_SITE_VALUES: ReadonlySet<string> = new Set(['lax', 'strict', 'none']);

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    require: {
      type: 'array',
      items: { type: 'string', enum: [...FLAGS] },
      uniqueItems: true,
      minItems: 1,
      description:
        "The flags an auth cookie must set. Defaults to all three, `['httpOnly', 'secure', 'sameSite']`; a configured list replaces the default.",
    },
    authCookieNames: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        "Cookie names checked by exact, case-sensitive match. Defaults to `['auth_token', 'session', 'sid', 'authToken']`; a configured list replaces the default.",
    },
    authCookiePattern: {
      type: 'string',
      minLength: 1,
      description:
        'A regular-expression source, compiled with the `u` flag and matched case-sensitively. Cookie names it matches are checked in addition to `authCookieNames`. Unset by default.',
    },
    trustedConfigNames: {
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      description:
        'Shared cookie configs: a spread of one of these (or a whole options argument named here) counts as setting every flag the object does not write itself. An entry ending in `()` matches any call to that callee. Defaults to none.',
    },
  },
};

/*
 * Reads five cookie write shapes and checks the flags of the ones that write an
 * auth cookie, chosen by name:
 *
 *   cookie.<name>.set(opts)            name from the member chain, options first
 *   set(name, value, opts)             a bare `set` call
 *   <any>.setCookie(name, value, opts) Fastify's `reply.setCookie`
 *   <any>.cookie(name, value, opts)    Express's `res.cookie`
 *   cookies().set(name, value, opts)   Next's cookie store, awaited or not
 *
 * The cookie name must be a static string. `httpOnly` passes only as literal
 * `true`. `secure` passes as literal `true` or any non-literal (an environment
 * check such as `isProd`). `sameSite` passes as `'lax'`, `'strict'` or `'none'`
 * in any case, or as a non-literal, and `'none'` also needs literal
 * `secure: true`. A spread or a whole options argument named in
 * `trustedConfigNames` counts as setting every flag the object does not write.
 */

/** The cookie name and options argument of one of the five write shapes. */
interface CookieWrite {
  readonly name: string;
  readonly options: TSESTree.Expression | undefined;
}

/** A string literal, or a template literal with no expressions, else null. */
function staticString(node: TSESTree.Node | undefined): string | null {
  if (node === undefined) return null;
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string' ? node.value : null;
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** A property key as a string: `a:`, `'a':` or computed `['a']`, else null. */
function staticKeyName(property: TSESTree.Property): string | null {
  if (!property.computed && property.key.type === AST_NODE_TYPES.Identifier) return property.key.name;
  return staticString(property.key);
}

/** The receiver of a callee written `<object>.<name>` with a dot, else null. */
function dotCallReceiver(callee: TSESTree.Expression, name: string): TSESTree.Expression | null {
  return callee.type === AST_NODE_TYPES.MemberExpression &&
    !callee.computed &&
    callee.property.type === AST_NODE_TYPES.Identifier &&
    callee.property.name === name
    ? callee.object
    : null;
}

/** The name read from `cookie.<name>` (or `cookie['<name>']`), else null. */
function cookieChainName(node: TSESTree.Expression): string | null {
  if (
    node.type !== AST_NODE_TYPES.MemberExpression ||
    node.object.type !== AST_NODE_TYPES.Identifier ||
    node.object.name !== 'cookie'
  ) {
    return null;
  }
  if (!node.computed) {
    return node.property.type === AST_NODE_TYPES.Identifier ? node.property.name : null;
  }
  return staticString(node.property);
}

/** Whether the receiver of `.set` is `cookies()`, awaited or not. */
function isCookieStore(node: TSESTree.Expression): boolean {
  const receiver = unwrapExpression(node);
  return (
    receiver.type === AST_NODE_TYPES.CallExpression &&
    receiver.callee.type === AST_NODE_TYPES.Identifier &&
    receiver.callee.name === 'cookies'
  );
}

/** Whether the call is `set(...)`, `<any>.setCookie(...)`, `<any>.cookie(...)` or `cookies().set(...)`. */
function isNameValueOptionsCall(callee: TSESTree.Expression): boolean {
  if (callee.type === AST_NODE_TYPES.Identifier) return callee.name === 'set';
  if (dotCallReceiver(callee, 'setCookie') !== null || dotCallReceiver(callee, 'cookie') !== null) return true;
  const receiver = dotCallReceiver(callee, 'set');
  return receiver !== null && isCookieStore(receiver);
}

function cookieWrite(node: TSESTree.CallExpression): CookieWrite | null {
  const { callee, arguments: args } = node;
  const setReceiver = dotCallReceiver(callee, 'set');
  if (setReceiver !== null) {
    const chainName = cookieChainName(setReceiver);
    if (chainName !== null) {
      const options = args[0];
      if (options?.type === AST_NODE_TYPES.SpreadElement) return null;
      return { name: chainName, options };
    }
  }
  if (!isNameValueOptionsCall(callee)) return null;
  const options = args[2];
  if (options?.type === AST_NODE_TYPES.SpreadElement || args[1]?.type === AST_NODE_TYPES.SpreadElement) return null;
  const name = staticString(args[0]);
  if (name === null) return null;
  return { name, options };
}

type FlagState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'trusted' }
  | { readonly kind: 'written'; readonly property: TSESTree.Property; readonly value: TSESTree.Expression };

const ABSENT: FlagState = { kind: 'absent' };
const TRUSTED: FlagState = { kind: 'trusted' };

function isFlag(name: string | null): name is CookieFlag {
  return name !== null && (FLAGS as readonly string[]).includes(name);
}

/** What the options argument says about each flag. */
function readFlags(
  options: TSESTree.Expression | undefined,
  trusted: SourceVocabulary,
  sourceCode: Readonly<TSESLint.SourceCode>,
): ReadonlyMap<CookieFlag, FlagState> {
  const states = new Map<CookieFlag, FlagState>();
  if (options === undefined) return states;
  const object = unwrapExpression(options);
  if (object.type !== AST_NODE_TYPES.ObjectExpression) {
    const fill = matchesVocabulary(object, trusted, sourceCode) ? TRUSTED : ABSENT;
    for (const flag of FLAGS) states.set(flag, fill);
    return states;
  }
  let trustedSpread = false;
  for (const property of object.properties) {
    if (property.type === AST_NODE_TYPES.SpreadElement) {
      if (matchesVocabulary(unwrapExpression(property.argument), trusted, sourceCode)) trustedSpread = true;
      continue;
    }
    const key = staticKeyName(property);
    if (!isFlag(key)) continue;
    const value = unwrapExpression(property.value as TSESTree.Expression);
    const isUndefined = value.type === AST_NODE_TYPES.Identifier && value.name === 'undefined';
    states.set(key, isUndefined ? ABSENT : { kind: 'written', property, value });
  }
  if (trustedSpread) {
    for (const flag of FLAGS) {
      if (!states.has(flag)) states.set(flag, TRUSTED);
    }
  }
  return states;
}

function isLiteralTrue(value: TSESTree.Expression): boolean {
  return value.type === AST_NODE_TYPES.Literal && value.value === true;
}

/** Whether a written value satisfies its flag on its own. */
function flagAccepted(flag: CookieFlag, value: TSESTree.Expression): boolean {
  switch (flag) {
    case 'httpOnly':
      return isLiteralTrue(value);
    case 'secure':
      return isLiteralTrue(value) || value.type !== AST_NODE_TYPES.Literal;
    case 'sameSite': {
      const text = staticString(value);
      if (text !== null) return SAME_SITE_VALUES.has(text.toLowerCase());
      return value.type !== AST_NODE_TYPES.Literal;
    }
  }
}

export const authCookieFlagsRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'An auth cookie (`session`, `sid`, `auth_token`, `authToken` by default) must be written with `httpOnly: true`, `secure` and a valid `sameSite`.',
    },
    schema: [optionSchema],
    messages: {
      missingFlag:
        'Auth cookie `{{cookie}}` is written without `{{flag}}`. Set it explicitly, or spread a config named in `trustedConfigNames`.',
      weakFlag:
        "Auth cookie `{{cookie}}` sets `{{flag}}` to a value that does not protect it. Use `httpOnly: true`, `secure: true` and `sameSite: 'lax'`, `'strict'` or `'none'`.",
      sameSiteNoneNeedsSecure:
        "Auth cookie `{{cookie}}` sets `sameSite: 'none'` without `secure: true`; browsers reject such a cookie. Set `secure: true`.",
    },
  },
  defaultOptions: [{ require: FLAGS, authCookieNames: DEFAULT_AUTH_COOKIE_NAMES, trustedConfigNames: [] }],
  create(context, [options]) {
    const required: ReadonlySet<CookieFlag> = new Set(options.require ?? FLAGS);
    const names: ReadonlySet<string> = new Set(options.authCookieNames ?? DEFAULT_AUTH_COOKIE_NAMES);
    const pattern = options.authCookiePattern === undefined ? null : new RegExp(options.authCookiePattern, 'u');
    const trusted = toVocabulary(options.trustedConfigNames ?? []);
    const { sourceCode } = context;

    return {
      CallExpression(node) {
        const write = cookieWrite(node);
        if (write === null) return;
        const cookie = write.name;
        if (!names.has(cookie) && pattern?.test(cookie) !== true) return;

        const states = readFlags(write.options, trusted, sourceCode);
        const reported = new Set<CookieFlag>();
        for (const flag of FLAGS) {
          if (!required.has(flag)) continue;
          const state = states.get(flag) ?? ABSENT;
          if (state.kind === 'absent') {
            context.report({ node: write.options ?? node, messageId: 'missingFlag', data: { cookie, flag } });
            reported.add(flag);
          } else if (state.kind === 'written' && !flagAccepted(flag, state.value)) {
            context.report({ node: state.property, messageId: 'weakFlag', data: { cookie, flag } });
            reported.add(flag);
          }
        }

        const sameSite = states.get('sameSite');
        if (!required.has('sameSite') || sameSite?.kind !== 'written') return;
        if (staticString(sameSite.value)?.toLowerCase() !== 'none') return;
        const secure = states.get('secure') ?? ABSENT;
        const secureHolds = secure.kind === 'trusted' || (secure.kind === 'written' && isLiteralTrue(secure.value));
        if (secureHolds || reported.has('secure')) return;
        context.report({ node: sameSite.property, messageId: 'sameSiteNoneNeedsSecure', data: { cookie } });
      },
    };
  },
});
