import { ruleTester } from '@noctcore/eslint-test-utils';

import { enforceContextConsumptionRule } from '../../src/rules/enforce-context-consumption';

const BOARD = ['**/components/board/**'];
const BOARD_TYPES = 'apps/web/src/components/board/TaskCard/TaskCard.types.ts';
const BOARD_ENTRY = 'apps/web/src/components/board/TaskCard/TaskCard.tsx';

// A compact stand-in for a real board registry: three scoped contexts.
const options = [
  {
    contexts: [
      { hook: 'useTaskActions', files: BOARD, providedProps: ['onRun', 'onCancel', 'onMerge'] },
      { hook: 'useBoardChrome', files: BOARD, providedProps: ['concurrency', 'autoMode'] },
      { hook: 'useWorktreesContext', files: BOARD, providedProps: ['worktrees'] },
    ],
  },
] as const;

const oneReThreadedMember = `
export interface TaskCardProps {
  task: Task;
  onRun: (id: string) => void;
}
`;

// The context value type declares the same members: the seam that defines the
// context is not a props contract.
const contextValueType = `
export interface TaskDetailActions {
  onRun: (id: string) => void;
  onMerge: (id: string) => void;
}
`;

ruleTester.run('enforce-context-consumption', enforceContextConsumptionRule, {
  valid: [
    // A contract with only owned props, and a component destructuring only those.
    {
      code: `export interface TaskCardProps {\n  task: Task;\n  compact: boolean;\n  onOpenSourceRef?: (ref: string) => void;\n}`,
      filename: BOARD_TYPES,
      options,
    },
    {
      code: `export function TaskCard({ task, compact }: TaskCardProps) {\n  return null;\n}`,
      filename: BOARD_ENTRY,
      options,
    },
    // Only `*Props` types are checked.
    { code: contextValueType, filename: BOARD_TYPES, options },
    { code: `export interface TaskCardState {\n  onRun: () => void;\n}`, filename: BOARD_TYPES, options },
    // A file outside the entry's globs, such as the composition root rendering the providers.
    {
      code: oneReThreadedMember,
      filename: 'apps/web/src/components/app/AppShell/AppShell.types.ts',
      options,
    },
    // An unannotated or non-Props parameter is not a props contract.
    { code: `export const Row = ({ onRun }) => null;`, filename: BOARD_ENTRY, options },
    { code: `export function run({ onRun }: RunArgs) {}`, filename: BOARD_ENTRY, options },
    // A computed key is not a prop name the rule can match.
    { code: `export interface TaskCardProps {\n  ['onRun']: () => void;\n}`, filename: BOARD_TYPES, options },
    // An intersection alias is not a type literal; only literal members are read.
    { code: `export type TaskCardProps = BaseProps & { task: Task };`, filename: BOARD_TYPES, options },
    // An empty registry checks nothing.
    { code: oneReThreadedMember, filename: BOARD_TYPES, options: [{ contexts: [] }] },
    { code: oneReThreadedMember, filename: BOARD_TYPES },
  ],
  invalid: [
    {
      code: oneReThreadedMember,
      filename: BOARD_TYPES,
      options,
      errors: [
        { messageId: 'reThreaded', data: { name: 'onRun', hook: 'useTaskActions' }, line: 4, column: 3 },
      ],
    },
    // Several members across two contexts each report once.
    {
      code: `export interface TaskCardProps {\n  onRun: (id: string) => void;\n  onMerge: (id: string) => void;\n  concurrency: number;\n}`,
      filename: BOARD_TYPES,
      options,
      errors: [
        { messageId: 'reThreaded', data: { name: 'onRun', hook: 'useTaskActions' } },
        { messageId: 'reThreaded', data: { name: 'onMerge', hook: 'useTaskActions' } },
        { messageId: 'reThreaded', data: { name: 'concurrency', hook: 'useBoardChrome' } },
      ],
    },
    // An object type alias and a method signature.
    {
      code: `export type TaskCardProps = {\n  task: Task;\n  worktrees: WorktreeInfo[];\n};`,
      filename: BOARD_TYPES,
      options,
      errors: [{ messageId: 'reThreaded', data: { name: 'worktrees', hook: 'useWorktreesContext' } }],
    },
    {
      code: `export interface TaskCardProps {\n  onRun(id: string): void;\n}`,
      filename: BOARD_TYPES,
      options,
      errors: [{ messageId: 'reThreaded', data: { name: 'onRun', hook: 'useTaskActions' } }],
    },
    // A component destructuring a re-threaded prop, in each function form.
    {
      code: [
        'export function TaskCard({ task, onRun }: TaskCardProps) { return null; }',
        'export const Column = ({ autoMode }: ColumnProps) => null;',
        'export const Lane = memo(function Lane({ onCancel: cancel }: LaneProps) { return null; });',
      ].join('\n'),
      filename: BOARD_ENTRY,
      options,
      errors: [
        { messageId: 'reThreaded', data: { name: 'onRun', hook: 'useTaskActions' }, line: 1 },
        { messageId: 'reThreaded', data: { name: 'autoMode', hook: 'useBoardChrome' }, line: 2 },
        { messageId: 'reThreaded', data: { name: 'onCancel', hook: 'useTaskActions' }, line: 3 },
      ],
    },
    // The contract and the component can share one .tsx file.
    {
      code: `interface RowProps {\n  onMerge: () => void;\n}\nexport function Row({ onMerge }: RowProps) {\n  return null;\n}`,
      filename: 'apps/web/src/components/board/TaskCard/Row.tsx',
      options,
      errors: [
        { messageId: 'reThreaded', line: 2 },
        { messageId: 'reThreaded', line: 4 },
      ],
    },
    // When two entries supply the same name, the first one is named.
    {
      code: oneReThreadedMember,
      filename: BOARD_TYPES,
      options: [
        {
          contexts: [
            { hook: 'useTaskActions', files: BOARD, providedProps: ['onRun'] },
            { hook: 'useLegacyActions', files: ['**'], providedProps: ['onRun'] },
          ],
        },
      ],
      errors: [{ messageId: 'reThreaded', data: { name: 'onRun', hook: 'useTaskActions' } }],
    },
  ],
});
