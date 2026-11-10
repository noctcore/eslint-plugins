import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';

import { createRule } from '../createRule';
import { propertyName } from '../utils/electron';

const RULE_NAME = 'webpreferences-locked';

type MessageIds = 'mustStayFalse' | 'mustStayTrue';

/** Flags that hand web content Node, a `<webview>` or insecure content when `true`. */
const MUST_STAY_FALSE = new Set([
  'nodeIntegration',
  'nodeIntegrationInSubFrames',
  'nodeIntegrationInWorker',
  'webviewTag',
  'allowRunningInsecureContent',
  'experimentalFeatures',
]);

/** Flags that remove a renderer isolation boundary when `false`. */
const MUST_STAY_TRUE = new Set(['contextIsolation', 'sandbox', 'webSecurity']);

/** Names generic enough outside Electron that they count only in a webPreferences-shaped object. */
const AMBIGUOUS = new Set(['sandbox']);

const ELECTRON_KEYS = new Set([...MUST_STAY_FALSE, ...MUST_STAY_TRUE].filter((key) => !AMBIGUOUS.has(key)));

/**
 * Whether an object literal is a set of web preferences: the value of a
 * `webPreferences` property, or an object that names another Electron-only
 * preference (`const prefs = { contextIsolation: true, sandbox: false }`).
 */
function isWebPreferences(object: TSESTree.ObjectExpression): boolean {
  const parent = object.parent;
  if (parent.type === AST_NODE_TYPES.Property && propertyName(parent) === 'webPreferences') {
    return true;
  }
  return object.properties.some(
    (member) =>
      member.type === AST_NODE_TYPES.Property && ELECTRON_KEYS.has(propertyName(member) ?? ''),
  );
}

/*
 * The Electron security checklist sets every isolation flag one way, and the
 * defaults already match it. Writing a flag the other way, even for a quick
 * debugging session, is how a renderer that loads remote content ends up with
 * Node. The check is literal-only: a flag set from a variable or a spread is
 * not seen, so keep these flags literal where the window is made.
 */
export const webpreferencesLockedRule = createRule<[], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow turning off an Electron renderer isolation flag: `nodeIntegration`, `webviewTag` or `allowRunningInsecureContent` set to `true`, or `contextIsolation`, `sandbox` or `webSecurity` set to `false`.',
    },
    schema: [],
    messages: {
      mustStayFalse:
        '`{{name}}: true` gives web content Node, a `<webview>` or insecure content. Leave it `false` (the default), and expose what the renderer needs through a preload with `contextBridge`.',
      mustStayTrue:
        '`{{name}}: false` removes a renderer isolation boundary. Leave it `true` (the default); move whatever needed it into the main process or a preload.',
    },
  },
  defaultOptions: [],
  create(context) {
    return {
      Property(node): void {
        const name = propertyName(node);
        if (name === null || node.value.type !== AST_NODE_TYPES.Literal) return;
        const value = node.value.value;
        const object = node.parent;
        if (object.type !== AST_NODE_TYPES.ObjectExpression) return;

        if (value === true && MUST_STAY_FALSE.has(name)) {
          context.report({ node, messageId: 'mustStayFalse', data: { name } });
          return;
        }
        if (value === false && MUST_STAY_TRUE.has(name)) {
          if (AMBIGUOUS.has(name) && !isWebPreferences(object)) return;
          context.report({ node, messageId: 'mustStayTrue', data: { name } });
        }
      },
    };
  },
});
