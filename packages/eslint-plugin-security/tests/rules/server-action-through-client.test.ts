import { ruleTester } from '@noctcore/eslint-test-utils';

import { serverActionThroughClientRule } from '../../src/rules/server-action-through-client';

const FILE = 'src/lib/contact/action.ts';
const CLIENTS = [{ actionClients: ['unauthenticatedAction', 'authActionClient'] }];
const CLIENTS_TEXT = '`unauthenticatedAction`, `authActionClient`';

ruleTester.run('server-action-through-client', serverActionThroughClientRule, {
  valid: [
    // The configured client, shortest chain: a single `.action(...)`.
    {
      code: `
'use server';
import { unauthenticatedAction } from '@/lib/safe-action';
export const ping = unauthenticatedAction.action(async () => 'pong');`,
      filename: FILE,
      options: CLIENTS,
    },
    // The configured client, three deep: the portfolio's exact shape.
    {
      code: `
'use server'
import { unauthenticatedAction } from '@/lib/safe-action'
export const sendEmailAction = unauthenticatedAction
  .metadata({ actionName: 'send Email Action' })
  .inputSchema(contactFormSchema)
  .action(async ({ parsedInput }) => {
    await sendMail(parsedInput)
  })`,
      filename: FILE,
      options: CLIENTS,
    },
    // Five deep, with `use` and `bindArgsSchemas` in the chain; depth does not matter.
    {
      code: `
'use server';
export const deleteUser = authActionClient
  .use(loggingMiddleware)
  .metadata({ actionName: 'deleteUser' })
  .bindArgsSchemas([z.string()])
  .inputSchema(schema)
  .action(async ({ parsedInput }) => db.user.delete(parsedInput));`,
      filename: FILE,
      options: CLIENTS,
    },
    // A client invoked directly, then chained: TanStack Start's builder shape.
    {
      code: `
'use server';
export const getUser = createServerFn({ method: 'GET' })
  .middleware([authMiddleware])
  .handler(async () => currentUser());`,
      filename: FILE,
      options: [{ actionClients: ['createServerFn'] }],
    },
    // A client reached through a namespace: the option may be dotted.
    {
      code: `
'use server';
export const save = clients.auth.inputSchema(schema).action(async () => {});`,
      filename: FILE,
      options: [{ actionClients: ['clients.auth'] }],
    },
    // A local alias of the built action, exported by name.
    {
      code: `
'use server';
const action = authActionClient.action(async () => {});
export { action as saveAction };`,
      filename: FILE,
      options: CLIENTS,
    },
    // Default export built from a client.
    {
      code: `
'use server';
export default authActionClient.inputSchema(schema).action(async () => {});`,
      filename: FILE,
      options: CLIENTS,
    },
    // `as const`, `satisfies` and `!` around the chain do not hide the root.
    {
      code: `
'use server';
export const a = (authActionClient.action(async () => {})) as Action;
export const b = authActionClient!.action(async () => {}) satisfies Action;`,
      filename: FILE,
      options: CLIENTS,
    },
    // Exported non-function values are not actions: a constant, a type, an interface, a re-export.
    {
      code: `
'use server';
export const LIMIT = 5;
export type Input = { name: string };
export interface Result { ok: boolean }
export { helper } from './helper';
export type { Other } from './other';
export * from './more';`,
      filename: FILE,
      options: CLIENTS,
    },
    // A non-exported raw function in a server module is not reachable from the client.
    {
      code: `
'use server';
async function internal() {}
export const run = authActionClient.action(async () => internal());`,
      filename: FILE,
      options: CLIENTS,
    },
    // No directive at all: a plain module, raw exports are fine.
    {
      code: `
import { db } from './db';
export async function deleteUser(id: string) { await db.user.delete({ where: { id } }); }
export const a = notAClient.action(async () => {});`,
      filename: FILE,
      options: CLIENTS,
    },
    // The directive is not the first statement, so it is not the module directive.
    {
      code: `
import { db } from './db';
'use server';
export async function deleteUser(id: string) { await db.user.delete({ where: { id } }); }`,
      filename: FILE,
      options: CLIENTS,
    },
    // A `'use server'` string that is not a directive (not an expression statement).
    {
      code: `
const mode = 'use server';
export async function run() {}`,
      filename: FILE,
      options: CLIENTS,
    },
    // Other directives are not this directive.
    {
      code: `
'use client';
export async function onClick() {}`,
      filename: FILE,
      options: CLIENTS,
    },
    // Inline action allowed by option.
    {
      code: `
export default function Page() {
  async function create(formData: FormData) {
    'use server';
    await db.post.create({ data: { title: formData.get('title') } });
  }
  return <form action={create}><button>Create</button></form>;
}`,
      filename: 'src/app/page.tsx',
      options: [{ actionClients: ['authActionClient'], allowInline: true }],
    },
    // A function body that merely starts with a different directive is not inline.
    {
      code: `
export default function Page() {
  function strict() { 'use strict'; return 1; }
  return <div>{strict()}</div>;
}`,
      filename: 'src/app/page.tsx',
      options: CLIENTS,
    },
    // In a server module the body directive is redundant and the export check governs:
    // built from a client, so nothing to report.
    {
      code: `
'use server';
export const run = authActionClient.action(async () => { 'use server'; return 1; });`,
      filename: FILE,
      options: CLIENTS,
    },
  ],
  invalid: [
    // The case the rule exists for: a raw exported async function.
    {
      code: `
'use server';
import { db } from './db';
export async function deleteUser(userId: string) {
  await db.user.delete({ where: { id: userId } });
}`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'deleteUser', clients: '`unauthenticatedAction`, `authActionClient`' }, line: 4, column: 23 }],
    },
    // A raw default export.
    {
      code: `
'use server';
export default async function (formData: FormData) {
  await db.post.create({ data: Object.fromEntries(formData) });
}`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'default', clients: CLIENTS_TEXT } }],
    },
    // A named raw default export.
    {
      code: `
'use server';
export default async function createPost() {}`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'createPost', clients: CLIENTS_TEXT } }],
    },
    // A non-async exported function is still a raw function with no client.
    {
      code: `
'use server';
export function sync() {}`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'sync', clients: CLIENTS_TEXT } }],
    },
    // A raw arrow function bound to an export.
    {
      code: `
'use server';
export const deleteUser = async (id: string) => { await db.user.delete({ where: { id } }); };`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'deleteUser', clients: CLIENTS_TEXT } }],
    },
    // A raw function expression bound to an export.
    {
      code: `
'use server';
export const run = async function () {};`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'run', clients: CLIENTS_TEXT } }],
    },
    // A chain rooted at an identifier that is not a configured client.
    {
      code: `
'use server';
export const sendEmailAction = unknownClient
  .metadata({ actionName: 'x' })
  .inputSchema(schema)
  .action(async () => {});`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'notThroughClient', data: { name: 'sendEmailAction', root: 'unknownClient.metadata', clients: CLIENTS_TEXT } }],
    },
    // A wrapper around a client-built action roots at the wrapper, not the client.
    {
      code: `
'use server';
export const run = withSentry(authActionClient.action(async () => {}));`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'notThroughClient', data: { name: 'run', root: 'withSentry', clients: CLIENTS_TEXT } }],
    },
    // A double-quoted directive counts too.
    {
      code: `
"use server";
export async function run() {}`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'run', clients: CLIENTS_TEXT } }],
    },
    // Empty `actionClients`: nothing is a client, so the portfolio's correct action is reported.
    // This is the proof the rule sees the file; it is why the rule ships off.
    {
      code: `
'use server'
export const sendEmailAction = unauthenticatedAction
  .metadata({ actionName: 'send Email Action' })
  .inputSchema(contactFormSchema)
  .action(async () => {})`,
      filename: FILE,
      options: [{ actionClients: [] }],
      errors: [{ messageId: 'notThroughClient', data: { name: 'sendEmailAction', root: 'unauthenticatedAction.metadata', clients: 'none configured' } }],
    },
    // Missing options entirely behaves the same as an empty list.
    {
      code: `
'use server';
export const sendEmailAction = unauthenticatedAction.action(async () => {});`,
      filename: FILE,
      errors: [{ messageId: 'notThroughClient', data: { name: 'sendEmailAction', root: 'unauthenticatedAction.action', clients: 'none configured' } }],
    },
    // A wrong client name behaves the same as an empty list.
    {
      code: `
'use server';
export const sendEmailAction = unauthenticatedAction.action(async () => {});`,
      filename: FILE,
      options: [{ actionClients: ['authActionClient'] }],
      errors: [{ messageId: 'notThroughClient', data: { name: 'sendEmailAction', root: 'unauthenticatedAction.action', clients: '`authActionClient`' } }],
    },
    // A local raw function exported by name is still a raw export.
    {
      code: `
'use server';
async function deleteUser(id: string) {}
export { deleteUser };`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'deleteUser', clients: CLIENTS_TEXT } }],
    },
    // A local alias of a raw arrow, exported by name and renamed.
    {
      code: `
'use server';
const impl = async () => {};
export { impl as run };`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'run', clients: CLIENTS_TEXT } }],
    },
    // Default export of a raw arrow.
    {
      code: `
'use server';
export default async () => {};`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'default', clients: CLIENTS_TEXT } }],
    },
    // A computed or `this`-rooted chain has no readable root and is not a configured client.
    {
      code: `
'use server';
export const run = clients['auth'].action(async () => {});`,
      filename: FILE,
      options: [{ actionClients: ['clients.auth'] }],
      errors: [{ messageId: 'notThroughClient', data: { name: 'run', root: "clients['auth'].action", clients: '`clients.auth`' } }],
    },
    // Several exports, each judged on its own: two reports, the client-built one silent.
    {
      code: `
'use server';
export const ok = authActionClient.action(async () => {});
export async function raw() {}
export const wrong = other.action(async () => {});`,
      filename: FILE,
      options: CLIENTS,
      errors: [
        { messageId: 'rawExport', data: { name: 'raw', clients: CLIENTS_TEXT } },
        { messageId: 'notThroughClient', data: { name: 'wrong', root: 'other.action', clients: CLIENTS_TEXT } },
      ],
    },
    // Inline action in a server component, reported by default.
    {
      code: `
export default function Page() {
  async function create(formData: FormData) {
    'use server';
    await db.post.create({ data: { title: formData.get('title') } });
  }
  return <form action={create}><button>Create</button></form>;
}`,
      filename: 'src/app/page.tsx',
      options: CLIENTS,
      errors: [{ messageId: 'inlineAction', data: { name: 'create' }, line: 3, column: 18 }],
    },
    // Inline action as an arrow bound to a const, and an anonymous one passed directly.
    {
      code: `
export default function Page() {
  const create = async (formData: FormData) => {
    'use server';
    await db.post.create({ data: { title: formData.get('title') } });
  };
  return <form action={async () => { 'use server'; await db.post.deleteMany(); }}><button>Create</button></form>;
}`,
      filename: 'src/app/page.tsx',
      options: CLIENTS,
      errors: [
        { messageId: 'inlineAction', data: { name: 'create' } },
        { messageId: 'inlineAction', data: { name: '(anonymous)' } },
      ],
    },
    // Inline action with an explicit `allowInline: false`.
    {
      code: `
export default function Page() {
  async function create() { 'use server'; }
  return <form action={create} />;
}`,
      filename: 'src/app/page.tsx',
      options: [{ actionClients: ['authActionClient'], allowInline: false }],
      errors: [{ messageId: 'inlineAction', data: { name: 'create' } }],
    },
    // A raw export whose body also carries the directive is reported once, as a raw export.
    {
      code: `
'use server';
export async function run() { 'use server'; }`,
      filename: FILE,
      options: CLIENTS,
      errors: [{ messageId: 'rawExport', data: { name: 'run', clients: CLIENTS_TEXT } }],
    },
  ],
});
