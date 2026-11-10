import { fileMatchesAnyGlob } from '@noctcore/eslint-utils';
import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { isElectronModule, isRequireElectron, propertyName } from '../utils/electron';

const RULE_NAME = 'no-shell-outside-allowlist';

export interface NoShellOutsideAllowlistOptions {
  /** Globs of the files that may use Electron's `shell`. */
  readonly allowIn?: readonly string[];
}

type RuleOptions = [NoShellOutsideAllowlistOptions];
type MessageIds = 'shellOutsideAllowlist';

/*
 * `shell.openExternal(url)` hands a URL to the operating system, which runs
 * whatever handles its scheme; `shell.openPath` opens a file with its default
 * application. One module should own those calls, behind a scheme and path
 * check, and every other file should go through it. This rule keeps `shell`
 * out of everywhere else, in each way it can be reached: the named import,
 * `electron.shell` through a default or namespace import or `require`, and
 * destructuring it from either.
 */
export const noShellOutsideAllowlistRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        "Restrict Electron's `shell` (`openExternal`, `openPath`) to the files listed in `allowIn`, so URLs and paths reach the operating system through one checked module.",
      requiresOptions: true,
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          allowIn: {
            type: 'array',
            items: { type: 'string' },
            uniqueItems: true,
            description:
              'Globs of the files that may use `shell`, matched against the absolute path and the path relative to the working directory or workspace root. Empty by default, so every use is reported.',
          },
        },
      },
    ],
    messages: {
      shellOutsideAllowlist:
        "Electron's `shell` is used outside its module. Call the module listed in `allowIn` instead, which checks the URL scheme or path before it reaches the operating system.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    if (fileMatchesAnyGlob(context.filename, options.allowIn ?? [], context.cwd)) return {};

    const report = (node: TSESTree.Node): void => {
      context.report({ node, messageId: 'shellOutsideAllowlist' });
    };

    return {
      ImportDeclaration(node): void {
        if (node.source.value !== 'electron') return;
        for (const specifier of node.specifiers) {
          if (specifier.type !== AST_NODE_TYPES.ImportSpecifier) continue;
          const imported = specifier.imported;
          const name = imported.type === AST_NODE_TYPES.Identifier ? imported.name : imported.value;
          if (name === 'shell') report(specifier);
        }
      },
      // `const { shell } = require('electron')` and `const { shell } = electron`.
      VariableDeclarator(node): void {
        if (node.id.type !== AST_NODE_TYPES.ObjectPattern || node.init == null) return;
        const init = node.init;
        const fromElectron =
          isRequireElectron(init) ||
          (init.type === AST_NODE_TYPES.Identifier &&
            isElectronModule(init, context.sourceCode.getScope(node)));
        if (!fromElectron) return;
        for (const property of node.id.properties) {
          if (property.type === AST_NODE_TYPES.Property && propertyName(property) === 'shell') {
            report(property);
          }
        }
      },
      // `electron.shell` and `require('electron').shell`.
      MemberExpression(node): void {
        if (node.computed || node.property.type !== AST_NODE_TYPES.Identifier) return;
        if (node.property.name !== 'shell') return;
        const object = node.object;
        if (
          isRequireElectron(object) ||
          (object.type === AST_NODE_TYPES.Identifier &&
            isElectronModule(object, context.sourceCode.getScope(node)))
        ) {
          report(node);
        }
      },
    };
  },
});
