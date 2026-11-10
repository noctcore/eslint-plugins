# @noctcore/eslint-utils

**Docs:** [noctcore.github.io/eslint-plugins](https://noctcore.github.io/eslint-plugins/)

The shared rule creator and AST helpers behind the `@noctcore/eslint-plugin-*` packages. It is
primarily an internal building block: you get it as a dependency of those plugins and do not need to
install it yourself to use them.

## Install

```sh
bun add @noctcore/eslint-utils   # or npm i / pnpm add
```

Peer dependencies: `eslint` 9 or 10 and `typescript` 5 or 6.

## What it exports

- `makeCreateRule(domain)`: a typed `RuleCreator` whose rules link their `meta.docs.url` to
  `https://noctcore.github.io/eslint-plugins/rules/<domain>/<rule>/`.
- `AST_NODE_TYPES`, `ESLintUtils` and the `TSESLint` / `TSESTree` types, re-exported from
  `@typescript-eslint/utils` so a plugin needs only this one dependency.

File scope:

- `matchesAnyGlob(filename, globs)`: true when the path (backslashes normalised to `/`) matches any
  glob. Supports `**` (a leading `**/` also matches zero directories), `*`, `?` and `{a,b}`
  alternation with wildcards and nesting inside. Use it for an `allowIn` option.
- `globToRegExp(glob)`: the compiled, cached RegExp behind it. `toPosixPath(path)` normalises
  separators.

Files a rule reads:

- `createFileCache(parse)`: a per-file cache keyed on path and mtime, so an editor session sees an
  edited schema or catalog without restarting the ESLint server. `get(file)` returns the parsed
  value, or `undefined` when the file is missing, not a regular file, or unreadable.

AST:

- `calleePath(node, { allowThis })`: dotted path of a callee (`client.http.get`), or null for any
  other shape; `allowThis` accepts `this.logger.info`.
- `calleeName(callee)`: the called name only (`mask` for `utils.mask(x)`, `this.a.mask(x)` or
  `make().mask(x)`), or null for computed access.
- `runnerName(callee)`: root identifier of a test-runner call (`describe.each(t)(...)` gives
  `describe`).
- `enclosingFunction(node)`, `isFunctionNode(node)` and the `FunctionNode` type.
- `walkSome(root, visitorKeys, predicate)` and `forEachDescendant(root, visitorKeys, visit)`: walk a
  subtree over `context.sourceCode.visitorKeys`, never following `parent`.
- `isSelfOrAncestor`, `unwrapTypeWrappers` (peels `as`, `satisfies`, `!`, `<T>x`) and
  `isStaticMemberAccess(node, 'process', 'env')` (dot and computed string forms).

Logger calls:

- `loggerCallMatcher(options)` and `loggerCallMethod(call, matcher)`: structural detection of
  `<logger>.<method>(...)`, including `this.logger.info(...)`; `DEFAULT_LOGGERS`,
  `DEFAULT_LOG_METHODS` and `loggerCallOptionProperties` (the `loggers` / `methods` option schema).

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
