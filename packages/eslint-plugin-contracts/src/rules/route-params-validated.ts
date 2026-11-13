import { calleeName } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { createRule } from '../createRule';
import { type RouterIdentity, routerRouteCall, routerUseCall } from '../utils/routerCall';

const RULE_NAME = 'route-params-validated';

export interface RouteParamsValidatedOptions {
  /** Called names that count as a param validator; defaults to `['param']`. */
  readonly validators?: readonly string[];
  /** Called names of validator factories whose first argument `'param'` makes a param validator; defaults to `['zValidator', 'validator']`. */
  readonly validatorFactories?: readonly string[];
  /** Identifier names treated as routers besides `new Hono()` bindings; defaults to none. */
  readonly routerNames?: readonly string[];
}

type RuleOptions = [RouteParamsValidatedOptions];
type MessageIds = 'unvalidatedParams';

/*
 * A route path such as `/calls/:id` declares parameters that arrive as raw
 * strings. A param validator in the chain turns them into checked values; a
 * route without one hands the handler unchecked input. This rule reports a
 * route call whose literal path has `:name` segments and whose chain holds no
 * param validator.
 *
 * ROUTERS: a route call counts only when its receiver is a router the file
 * proves: `new Hono()`, a `const` bound to one (also through `.basePath(...)`
 * and other router methods), or an identifier named in `routerNames`. Imported
 * routers, `let` bindings, `app.route(...)` sub-routers and `app.on(...)` are
 * not read.
 *
 * VALIDATORS: a chain argument is a param validator when it is a call whose
 * called name is in `validators` (`param(S)`, `v.param(S)`), or a call to a
 * name in `validatorFactories` whose first argument is the string `'param'`.
 * A `.use(...)` call on the same router binding that carries a param validator
 * silences every route on that binding, wherever it appears in the file.
 */
const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    validators: {
      type: 'array',
      description:
        'Called names that count as a param validator, for example `param` in `param(Schema)`. Defaults to `param`.',
      items: { type: 'string', minLength: 1 },
    },
    validatorFactories: {
      type: 'array',
      description:
        'Called names of validator factories that validate params when their first argument is the string `param`, for example `zValidator`. Defaults to `zValidator` and `validator`.',
      items: { type: 'string', minLength: 1 },
    },
    routerNames: {
      type: 'array',
      description:
        'Identifier names treated as routers in addition to bindings of `new Hono()`, for example `router`. Defaults to none.',
      items: { type: 'string', minLength: 1 },
    },
  },
};

const PARAM_SEGMENT = /^:([A-Za-z_$][\w$]*)/;

function pathParams(
  path: TSESTree.StringLiteral | TSESTree.TemplateLiteral,
): { text: string; names: string[] } | null {
  let text: string | null;
  if (path.type === AST_NODE_TYPES.Literal) {
    text = path.value;
  } else {
    text = path.quasis[0]?.value.cooked ?? null;
  }
  if (text === null) {
    return null;
  }
  const names: string[] = [];
  for (const segment of text.split('/')) {
    const match = PARAM_SEGMENT.exec(segment);
    if (match?.[1] !== undefined) {
      names.push(match[1]);
    }
  }
  return { text, names };
}

function isParamValidator(
  arg: TSESTree.CallExpressionArgument,
  validators: ReadonlySet<string>,
  factories: ReadonlySet<string>,
): boolean {
  if (arg.type !== AST_NODE_TYPES.CallExpression) {
    return false;
  }
  const name = calleeName(arg.callee);
  if (name === null) {
    return false;
  }
  if (validators.has(name)) {
    return true;
  }
  const [first] = arg.arguments;
  return (
    factories.has(name) &&
    first !== undefined &&
    first.type === AST_NODE_TYPES.Literal &&
    first.value === 'param'
  );
}

interface Pending {
  readonly router: RouterIdentity;
  readonly path: TSESTree.StringLiteral | TSESTree.TemplateLiteral;
  readonly text: string;
  readonly names: readonly string[];
}

export const routeParamsValidatedRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require a route whose path declares `:name` parameters to carry a param validator in its handler chain.',
    },
    schema: [optionSchema],
    messages: {
      unvalidatedParams:
        'Route `{{path}}` declares {{params}}, but no argument in its chain validates them. Add a param validator such as `param(Schema)` or `zValidator(\'param\', Schema)`.',
    },
  },
  defaultOptions: [
    { validators: ['param'], validatorFactories: ['zValidator', 'validator'], routerNames: [] },
  ],
  create(context, [options]) {
    const validators = new Set(options.validators ?? ['param']);
    const factories = new Set(options.validatorFactories ?? ['zValidator', 'validator']);
    const routerNames = new Set(options.routerNames ?? []);
    const { sourceCode } = context;

    const pending: Pending[] = [];
    const validatedRouters = new Set<RouterIdentity>();

    return {
      CallExpression(node): void {
        const route = routerRouteCall(node, sourceCode, routerNames);
        if (route !== null) {
          const params = pathParams(route.path);
          if (
            params !== null &&
            params.names.length > 0 &&
            !route.chain.some((arg) => isParamValidator(arg, validators, factories))
          ) {
            pending.push({ router: route.router, path: route.path, ...params });
          }
          return;
        }
        const use = routerUseCall(node, sourceCode, routerNames);
        if (use !== null && use.args.some((arg) => isParamValidator(arg, validators, factories))) {
          validatedRouters.add(use.router);
        }
      },
      'Program:exit'(): void {
        for (const entry of pending) {
          if (validatedRouters.has(entry.router)) {
            continue;
          }
          context.report({
            node: entry.path,
            messageId: 'unvalidatedParams',
            data: {
              path: entry.text,
              params: entry.names.map((name) => `\`${name}\``).join(', '),
            },
          });
        }
      },
    };
  },
});
