# @noctcore/eslint-utils

**Docs:** [noctcore.github.io/eslint-plugins](https://noctcore.github.io/eslint-plugins/)

The shared rule creator and AST helpers behind the `@noctcore/eslint-plugin-*` packages. It is
primarily an internal building block: you get it as a dependency of those plugins and do not need to
install it yourself to use them.

## Install

```sh
bun add @noctcore/eslint-utils   # or npm i / pnpm add
```

Peer dependencies: `eslint` 9 or newer and `typescript` 5 or newer.

## What it exports

- `makeCreateRule(domain)`: a typed `RuleCreator` whose rules link their `meta.docs.url` to
  `https://noctcore.github.io/eslint-plugins/rules/<domain>/<rule>/`.
- `AST_NODE_TYPES`, `ESLintUtils` and the `TSESLint` / `TSESTree` types, re-exported from
  `@typescript-eslint/utils` so a plugin needs only this one dependency.

## Example

```ts
import { AST_NODE_TYPES, makeCreateRule } from '@noctcore/eslint-utils';

const createRule = makeCreateRule('security');

export const noEvalRule = createRule({
  name: 'no-eval',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow `eval()`.' },
    schema: [],
    messages: { noEval: 'Do not call `eval()`.' },
  },
  defaultOptions: [],
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type === AST_NODE_TYPES.Identifier && node.callee.name === 'eval') {
          context.report({ node, messageId: 'noEval' });
        }
      },
    };
  },
});
```

## License

MIT
