import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { type Analysis, createAnalysis, type Flow, staticPropertyName, unwrap } from '../llm-output';
import { prefixPinsOrigin } from '../url-origin';

const RULE_NAME = 'no-llm-output-to-sink';

type MessageIds = 'llmOutputToSink';

/*
 * OWASP Top 10 for LLM Applications 2025, LLM05 "Improper Output Handling":
 * whatever went into the prompt (user text, a retrieved page, a tool result)
 * can steer what comes out, so model output is untrusted input. Handing it to
 * `eval`, a shell, raw SQL, the DOM, a request URL or a file path turns a
 * prompt injection into code execution, SQL injection, XSS, SSRF or path
 * traversal.
 *
 * PRECISION IS THE POINT. The rule reports only when the whole chain is in
 * the source: an awaited, recognised SDK call, followed through `const`
 * bindings and destructuring to the field that holds the model's text, and
 * from there into a sink argument. A parameter, a `let`, a helper call, a
 * sanitizer or a schema `.parse` ends the chain, and an ended chain is silent.
 */

/** `child_process` functions that always run their command through a shell. */
const ALWAYS_SHELL: ReadonlySet<string> = new Set(['exec', 'execSync']);
/** `child_process` functions that use a shell only when asked to. */
const CONDITIONAL_SHELL: ReadonlySet<string> = new Set([
  'execFile',
  'execFileSync',
  'spawn',
  'spawnSync',
]);

/** `fs` functions whose first argument is a path. */
const FS_ONE_PATH: ReadonlySet<string> = new Set([
  'access',
  'accessSync',
  'appendFile',
  'appendFileSync',
  'chmod',
  'chmodSync',
  'createReadStream',
  'createWriteStream',
  'existsSync',
  'lstat',
  'lstatSync',
  'mkdir',
  'mkdirSync',
  'open',
  'openSync',
  'opendir',
  'opendirSync',
  'readdir',
  'readdirSync',
  'readFile',
  'readFileSync',
  'rm',
  'rmdir',
  'rmdirSync',
  'rmSync',
  'stat',
  'statSync',
  'truncate',
  'truncateSync',
  'unlink',
  'unlinkSync',
  'writeFile',
  'writeFileSync',
]);
/** `fs` functions whose first two arguments are both paths. */
const FS_TWO_PATHS: ReadonlySet<string> = new Set([
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'link',
  'linkSync',
  'rename',
  'renameSync',
  'symlink',
  'symlinkSync',
]);

const HTML_PROPERTIES: ReadonlySet<string> = new Set(['innerHTML', 'outerHTML']);
const PRISMA_UNSAFE: ReadonlySet<string> = new Set(['$executeRawUnsafe', '$queryRawUnsafe']);
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'self', 'window']);

type Argument = TSESTree.CallExpressionArgument | undefined;

/** True when a value node enables a shell (`shell: true` or a shell-path string). */
function isShellEnabled(value: TSESTree.Node): boolean {
  if (value.type !== AST_NODE_TYPES.Literal) {
    return false;
  }
  return value.value === true || (typeof value.value === 'string' && value.value !== '');
}

/** True when any argument is an options object literal requesting a shell. */
function argsRequestShell(args: readonly TSESTree.CallExpressionArgument[]): boolean {
  return args.some(
    (arg) =>
      arg.type === AST_NODE_TYPES.ObjectExpression &&
      arg.properties.some(
        (prop) =>
          prop.type === AST_NODE_TYPES.Property &&
          !prop.computed &&
          ((prop.key.type === AST_NODE_TYPES.Identifier && prop.key.name === 'shell') ||
            (prop.key.type === AST_NODE_TYPES.Literal && prop.key.value === 'shell')) &&
          isShellEnabled(prop.value),
      ),
  );
}

/** `name(...)`, or `window.name(...)` / `globalThis.name(...)`, where `name` is the global. */
function isGlobalCall(callee: TSESTree.Node, name: string, analysis: Analysis): boolean {
  const node = unwrap(callee);
  if (node.type === AST_NODE_TYPES.Identifier) {
    return node.name === name && analysis.isGlobal(node);
  }
  return (
    node.type === AST_NODE_TYPES.MemberExpression &&
    staticPropertyName(node) === name &&
    node.object.type === AST_NODE_TYPES.Identifier &&
    GLOBAL_OBJECTS.has(node.object.name) &&
    analysis.isGlobal(node.object)
  );
}

type UrlPart =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'output'; readonly flow: Flow }
  | { readonly kind: 'runtime' };

/**
 * A URL flattened into author text, model output and other runtime values,
 * following template literals, `+` and `const` bindings, so the position of
 * the model output in the URL can be read.
 */
function urlParts(raw: TSESTree.Node, analysis: Analysis, seen: Set<TSESTree.Node>): UrlPart[] {
  const node = unwrap(raw);
  if (node.type === AST_NODE_TYPES.Literal) {
    return typeof node.value === 'string' || typeof node.value === 'number'
      ? [{ kind: 'text', value: String(node.value) }]
      : [{ kind: 'runtime' }];
  }
  if (node.type === AST_NODE_TYPES.TemplateLiteral) {
    const parts: UrlPart[] = [];
    node.quasis.forEach((quasi, index) => {
      parts.push({ kind: 'text', value: quasi.value.cooked ?? quasi.value.raw });
      const expression = node.expressions[index];
      if (expression !== undefined) {
        parts.push(...urlParts(expression, analysis, seen));
      }
    });
    return parts;
  }
  if (node.type === AST_NODE_TYPES.BinaryExpression && node.operator === '+') {
    return [...urlParts(node.left, analysis, seen), ...urlParts(node.right, analysis, seen)];
  }
  if (node.type === AST_NODE_TYPES.Identifier) {
    const init = analysis.constInit(node);
    if (
      init !== null &&
      !seen.has(init) &&
      (init.type === AST_NODE_TYPES.TemplateLiteral ||
        init.type === AST_NODE_TYPES.BinaryExpression ||
        init.type === AST_NODE_TYPES.Literal)
    ) {
      seen.add(init);
      return urlParts(init, analysis, seen);
    }
  }
  const flow = analysis.flowOf(node);
  return flow?.kind === 'output' ? [{ kind: 'output', flow }] : [{ kind: 'runtime' }];
}

/**
 * The model output that decides a URL's origin, or null. Output after a
 * prefix that already pins the origin (`https://api.example.com/q?${text}`)
 * only moves the path or query, which is not SSRF; output after a runtime
 * value the rule cannot see is not reported either.
 */
function outputControllingOrigin(node: TSESTree.Node, analysis: Analysis): Flow | null {
  let prefix = '';
  for (const part of urlParts(node, analysis, new Set())) {
    if (part.kind === 'runtime') {
      return null;
    }
    if (part.kind === 'output') {
      return prefix === '' || !prefixPinsOrigin(prefix) ? part.flow : null;
    }
    prefix += part.value;
  }
  return null;
}

export const noLlmOutputToSinkRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Text an LLM SDK call returned must not reach `eval`, a shell, raw SQL, HTML injection, a `fetch` origin or an `fs` path in the same function without being validated or sanitized first.',
    },
    schema: [],
    messages: {
      llmOutputToSink:
        'Output of {{source}} reaches {{sink}} unchecked. Model output follows whatever the prompt contained (user text, retrieved documents, tool results), so treat it as untrusted input: validate it against a schema, sanitize it, or keep it out of this sink.',
    },
  },
  defaultOptions: [],
  create(context) {
    const analysis = createAnalysis(context.sourceCode);

    function check(argument: Argument | TSESTree.Node | null, sink: string): void {
      if (
        argument === undefined ||
        argument === null ||
        argument.type === AST_NODE_TYPES.SpreadElement
      ) {
        return;
      }
      const flow = analysis.flowOf(argument);
      if (flow?.kind !== 'output') {
        return;
      }
      context.report({
        node: argument,
        messageId: 'llmOutputToSink',
        data: { source: flow.source, sink },
      });
    }

    function checkModuleCall(node: TSESTree.CallExpression): void {
      const member = analysis.moduleMemberOf(node.callee);
      if (member === null) {
        return;
      }
      const { module, path } = member;
      const [first, second] = node.arguments;
      if (module === 'child_process' && path.length === 1) {
        const method = path[0] ?? '';
        const shell =
          ALWAYS_SHELL.has(method) ||
          (CONDITIONAL_SHELL.has(method) && argsRequestShell(node.arguments));
        if (!shell) {
          return;
        }
        const sink = `the shell command of \`${method}\``;
        check(first, sink);
        // With a shell, the arguments are joined into the command line too.
        if (!ALWAYS_SHELL.has(method) && second?.type === AST_NODE_TYPES.ArrayExpression) {
          for (const element of second.elements) {
            check(element, sink);
          }
        }
        return;
      }
      const method =
        path.length === 1 || (path.length === 2 && path[0] === 'promises') ? path.at(-1) : undefined;
      if (module !== 'fs' || method === undefined) {
        return;
      }
      const sink = `a path argument of \`fs.${method}\``;
      if (FS_ONE_PATH.has(method)) {
        check(first, sink);
      } else if (FS_TWO_PATHS.has(method)) {
        check(first, sink);
        check(second, sink);
      }
    }

    function checkCall(node: TSESTree.CallExpression | TSESTree.NewExpression): void {
      const [first, second] = node.arguments;
      if (isGlobalCall(node.callee, 'Function', analysis)) {
        for (const argument of node.arguments) {
          check(argument, '`new Function`');
        }
        return;
      }
      if (node.type === AST_NODE_TYPES.NewExpression) {
        return;
      }
      if (isGlobalCall(node.callee, 'eval', analysis)) {
        check(first, '`eval`');
        return;
      }
      if (isGlobalCall(node.callee, 'fetch', analysis)) {
        if (first !== undefined && first.type !== AST_NODE_TYPES.SpreadElement) {
          const flow = outputControllingOrigin(first, analysis);
          if (flow?.kind === 'output') {
            context.report({
              node: first,
              messageId: 'llmOutputToSink',
              data: { source: flow.source, sink: 'the origin of a `fetch` URL' },
            });
          }
        }
        return;
      }
      const callee = unwrap(node.callee);
      if (callee.type === AST_NODE_TYPES.MemberExpression) {
        const method = staticPropertyName(callee);
        if (method !== null && PRISMA_UNSAFE.has(method)) {
          // Only the SQL text; the remaining arguments are bound parameters.
          check(first, `\`${method}\``);
          return;
        }
        if (method === 'insertAdjacentHTML') {
          check(second, '`insertAdjacentHTML`');
          return;
        }
        if (
          (method === 'write' || method === 'writeln') &&
          callee.object.type === AST_NODE_TYPES.Identifier &&
          callee.object.name === 'document' &&
          analysis.isGlobal(callee.object)
        ) {
          for (const argument of node.arguments) {
            check(argument, `\`document.${method}\``);
          }
          return;
        }
      }
      checkModuleCall(node);
    }

    return {
      CallExpression: checkCall,
      NewExpression: checkCall,
      AssignmentExpression(node): void {
        if (
          (node.operator !== '=' && node.operator !== '+=') ||
          node.left.type !== AST_NODE_TYPES.MemberExpression
        ) {
          return;
        }
        const property = staticPropertyName(node.left);
        if (property !== null && HTML_PROPERTIES.has(property)) {
          check(node.right, `\`${property}\``);
        }
      },
      JSXAttribute(node): void {
        if (
          node.name.type !== AST_NODE_TYPES.JSXIdentifier ||
          node.name.name !== 'dangerouslySetInnerHTML' ||
          node.value?.type !== AST_NODE_TYPES.JSXExpressionContainer ||
          node.value.expression.type !== AST_NODE_TYPES.ObjectExpression
        ) {
          return;
        }
        for (const property of node.value.expression.properties) {
          if (
            property.type === AST_NODE_TYPES.Property &&
            !property.computed &&
            ((property.key.type === AST_NODE_TYPES.Identifier && property.key.name === '__html') ||
              (property.key.type === AST_NODE_TYPES.Literal && property.key.value === '__html'))
          ) {
            check(property.value, '`dangerouslySetInnerHTML`');
          }
        }
      },
    };
  },
});
