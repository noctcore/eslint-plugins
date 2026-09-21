import { ruleTester } from '@noctcore/eslint-test-utils';

import { singleSemanticModuleRule } from '../../src/rules/single-semantic-module';

const TS = 'src/module.ts';
const TSX = 'src/Component.tsx';
const mixed = { messageId: 'mixedSemanticCategories' } as const;

/** The exact report text for a set of categories, in canonical order. */
function message(...categories: string[]): string {
  return [
    'Mixed semantic categories detected in module:',
    ...categories.map((category) => `- ${category}`),
    '',
    'A module must contain only one semantic concern.',
    'Move declarations into separate files/modules.',
  ].join('\n');
}

ruleTester.run('single-semantic-module', singleSemanticModuleRule, {
  valid: [
    // ---- The two cases that decide whether people keep this rule.
    {
      // A private render helper next to the exported component.
      code: [
        'function renderBadge(count: number) {',
        '  return <span className="badge">{count}</span>;',
        '}',
        'export function Inbox({ unread }: { unread: number }) {',
        '  return <div>{renderBadge(unread)}</div>;',
        '}',
      ].join('\n'),
      filename: TSX,
    },
    {
      // A two-line filter constant inside a hook file.
      code: [
        "const ACTIVE_FILTER = { status: 'active', archived: false } as const;",
        'export function useActiveProjects() {',
        '  return useQuery({ queryKey: ["projects", ACTIVE_FILTER] });',
        '}',
      ].join('\n'),
      filename: TS,
    },
    // Private config, a private helper and a private class all serve one hook.
    {
      code: [
        "const SWITCH_FILTERS = { poles: [3, 5], kinds: ['blade', 'toggle'] } as const;",
        'function labelFor(kind: string) { return kind.toUpperCase(); }',
        'class Cursor { position = 0; }',
        'export function useSwitchesChapter() {',
        "  return { filters: SWITCH_FILTERS, label: labelFor('blade'), cursor: new Cursor() };",
        '}',
      ].join('\n'),
      filename: TS,
    },

    // ---- One category per module.
    { code: 'export interface User {}\nexport type UserId = string;', filename: TS },
    {
      code: "export const USER_ROLE_ADMIN = 'admin';\nexport const USER_ROLE_USER = 'user';",
      filename: TS,
    },
    { code: 'export function createUser() {}\nexport function deleteUser() {}', filename: TS },
    { code: 'export const a = () => true, b = () => false;', filename: TS },
    {
      code: 'export const createUser = () => {};\nexport const deleteUser = function deleteUser() {};',
      filename: TS,
    },
    { code: 'export class UserService {}\nexport class ProjectService {}', filename: TS },
    { code: 'export default class UserService {}', filename: TS },
    {
      code: 'export function UserCard() {\n  return <div />;\n}\nexport const ProjectCard = () => <section />;',
      filename: TSX,
    },
    { code: 'export function useUser() {}\nexport const useProject = () => {};', filename: TS },
    {
      code: "import { z } from 'zod';\nexport const UserSchema = z.object({});\nexport const ProjectSchema = z.object({});",
      filename: TS,
    },
    { code: "import * as z from 'zod';\nexport const UserSchema = z.object({});", filename: TS },
    { code: "import z from 'zod';\nexport const UserSchema = z.object({});", filename: TS },

    // ---- Re-exports and imports are not declarations.
    {
      code: "import type { User } from './types';\nexport type { User };\nexport { createUser } from './createUser';\nexport * from './other';",
      filename: TS,
    },
    {
      code: "import type { User } from './types';\nexport { type User };\nexport { createUser } from './createUser';",
      filename: TS,
    },

    // ---- Nested declarations do not count; overloads are one function.
    {
      code: 'export function createUser() {\n  type Local = string;\n  const value = 1;\n  return value;\n}',
      filename: TS,
    },
    {
      code: [
        'export function parse(value: string): string;',
        'export function parse(value: number): string;',
        'export function parse(value: string | number): string {',
        '  return String(value);',
        '}',
      ].join('\n'),
      filename: TS,
    },
    { code: 'export namespace Models {\n  export interface User {}\n  export const DEFAULT_USER = {};\n}', filename: TS },

    // ---- Ambient declarations.
    {
      code: 'export {};\ndeclare global {\n  interface Window {\n    appVersion: string;\n  }\n}',
      filename: TS,
    },
    {
      code: 'declare const runtimeValue: string;\nexport function createUser() {}',
      filename: TS,
      options: [{ ignorePrivateDeclarations: false, ignoreAmbientDeclarations: true }],
    },

    // ---- Options.
    {
      code: "export interface User {}\nexport enum UserRole {\n  Admin = 'admin',\n}",
      filename: TS,
      options: [{ enumCategory: 'type' }],
    },
    {
      code: "import { z } from 'zod';\nexport interface User {}\nexport const UserSchema = z.object({});",
      filename: TS,
      options: [{ allow: [['type', 'schema']] }],
    },
    {
      // The NestJS `.constants.ts` shape: one module's enums, unions and DI tokens.
      code: [
        "export const BILLING_QUEUE = Symbol('BILLING_QUEUE');",
        "export const INVOICE_STATUSES = ['draft', 'sent', 'paid'] as const;",
        'export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];',
        "export enum BillingEvent {\n  Paid = 'billing.paid',\n}",
      ].join('\n'),
      filename: 'src/billing/billing.constants.ts',
      options: [{ allow: [['constant', 'type', 'enum']] }],
    },
    {
      code: 'export function UserCard() {\n  return <div />;\n}\nexport function useUserCard() {}',
      filename: TSX,
      options: [{ allow: [['react-component', 'hook']] }],
    },
    {
      // Schema detection off: a zod call is just a constant.
      code: "import { z } from 'zod';\nexport const UserSchema = z.object({});\nexport const LIMIT = 5;",
      filename: TS,
      options: [{ schemaLibraries: ['yup'] }],
    },
    {
      // Component detection off: a JSX-returning function is a function.
      code: 'export function UserCard() {\n  return <div />;\n}\nexport function formatName() {}',
      filename: TSX,
      options: [{ reactComponentDetection: { enabled: false } }],
    },
    {
      // Hook detection off: `useX` is a plain function.
      code: 'export function useThing() {}\nexport function formatThing() {}',
      filename: TS,
      options: [{ hookDetection: { enabled: false } }],
    },
    {
      // A custom hook name pattern: `useX` no longer matches, so both are functions.
      code: 'export function useThing() {}\nexport function formatThing() {}',
      filename: TS,
      options: [{ hookDetection: { namePattern: '^with[A-Z]' } }],
    },

    // ---- A module that exports nothing has no surface to mix.
    { code: 'const a = 1;\nfunction b() {}\nclass C {}\nb();', filename: 'src/script.ts' },
    // A local `z` is not a schema library.
    {
      code: 'const z = { object: () => ({}) };\nexport const A = z.object();\nexport const B = 2;',
      filename: TS,
    },
  ],
  invalid: [
    // ---- Exported declarations are surface; private helpers never excuse a mix.
    {
      code: 'function helper() { return 1; }\nexport function useThing() { return helper(); }\nexport const THING_LIMIT = 3;',
      filename: TS,
      errors: [{ ...mixed, data: { message: message('constant', 'hook') } }],
    },
    {
      code: 'export const SWITCH_FILTERS = { poles: [3, 5] } as const;\nexport function useSwitchesChapter() {\n  return SWITCH_FILTERS;\n}',
      filename: TS,
      errors: [mixed],
    },
    // ---- A declaration exported later by name is surface too.
    {
      code: 'interface User {}\nconst DEFAULT_USER = {};\nexport { DEFAULT_USER, type User };',
      filename: TS,
      errors: [{ ...mixed, data: { message: message('type', 'constant') } }],
    },
    {
      code: 'function UserCard() {\n  return <div />;\n}\nconst CARD_WIDTH = 320;\nexport { CARD_WIDTH };\nexport default UserCard;',
      filename: TSX,
      errors: [{ ...mixed, data: { message: message('constant', 'react-component') } }],
    },
    // ---- Opting back into upstream's old default: private declarations count.
    {
      code: 'const SWITCH_FILTERS = { poles: [3, 5] } as const;\nexport function useSwitchesChapter() {\n  return SWITCH_FILTERS;\n}',
      filename: TS,
      options: [{ ignorePrivateDeclarations: false }],
      errors: [mixed],
    },
    {
      code: 'declare const runtimeValue: string;\nexport function createUser() {}',
      filename: TS,
      options: [{ ignorePrivateDeclarations: false }],
      errors: [mixed],
    },

    // ---- Category mixes.
    {
      code: 'export interface User {}\nexport const DEFAULT_USER = {};',
      filename: TS,
      errors: [{ ...mixed, data: { message: message('type', 'constant') }, line: 2 }],
    },
    { code: 'export const USER_LIMIT = 5;\nexport function validateUser() {}', filename: TS, errors: [mixed] },
    { code: 'export class UserService {}\nexport function createUser() {}', filename: TS, errors: [mixed] },
    {
      code: 'export function UserCard() {\n  return <div />;\n}\nexport function useUser() {}',
      filename: TSX,
      errors: [mixed],
    },
    {
      code: "import { z } from 'zod';\nexport const UserSchema = z.object({});\nexport function validateUser() {}",
      filename: TS,
      errors: [mixed],
    },
    {
      code: "export enum UserRole {\n  Admin = 'admin',\n}\nexport function getRole() {}",
      filename: TS,
      errors: [mixed],
    },
    {
      code: 'export const USER_LIMIT = 5, validateUser = () => true;',
      filename: TS,
      errors: [{ ...mixed, data: { message: message('constant', 'function') } }],
    },
    {
      code: "import { z } from 'zod';\nexport interface User {}\nexport default z.object({});",
      filename: TS,
      errors: [{ ...mixed, data: { message: message('type', 'schema') } }],
    },
    {
      // Reported where the second concern starts, not on the second declaration.
      code: 'export type A = 1;\nexport type B = 2;\nexport const C = 3;',
      filename: TS,
      errors: [{ ...mixed, line: 3 }],
    },
    {
      // An `allow` group must cover every detected category.
      code: "export const TOKEN = Symbol('T');\nexport type T = string;\nexport function build() {}",
      filename: 'src/billing/billing.constants.ts',
      options: [{ allow: [['constant', 'type', 'enum']] }],
      errors: [mixed],
    },
    {
      code: 'export interface User {}\nexport const DEFAULT_USER = {};',
      filename: TS,
      options: [{ debug: true }],
      errors: [
        {
          ...mixed,
          data: {
            message: [
              'Mixed semantic categories detected in module:',
              '- type',
              '- constant',
              '',
              'Detected declarations:',
              '- type: User (TypeScript type-space declaration)',
              '- constant: DEFAULT_USER (object literal runtime value)',
              '',
              'A module must contain only one semantic concern.',
              'Move declarations into separate files/modules.',
            ].join('\n'),
          },
        },
      ],
    },
  ],
});
