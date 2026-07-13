import { ruleTester } from '@noctcore/eslint-test-utils';

import { componentPropsNamingRule } from '../../src/rules/component-props-naming';

const FILE = 'Button.tsx';

ruleTester.run('component-props-naming', componentPropsNamingRule, {
  valid: [
    // Correctly named props type.
    {
      code: `export function Button(props: ButtonProps) { return <button>{props.label}</button>; }`,
      filename: FILE,
    },
    // Destructured, correctly named.
    {
      code: `export function Modal({ open }: ModalProps) { return <div>{open}</div>; }`,
      filename: FILE,
    },
    // PascalCase but does not return JSX — not treated as a component.
    {
      code: `export function CreateStore(opts: StoreOptions) { return { get() { return opts; } }; }`,
      filename: FILE,
    },
    // Generic wrapper annotation — no single name to rename, left alone.
    {
      code: `export function Card(props: PropsWithChildren<CardStuff>) { return <div>{props.children}</div>; }`,
      filename: FILE,
    },
    // Untyped props — nothing to name.
    {
      code: `export function Thing(props) { return <div>{props.x}</div>; }`,
      filename: FILE,
    },
    // camelCase (a hook / plain function) is never a component.
    {
      code: `export function useThing(opts: Options) { return <div />; }`,
      filename: FILE,
    },
    // `requireExported` narrows to exported components only.
    {
      code: `function Button(props: Props) { return <button />; }`,
      filename: FILE,
      options: [{ requireExported: true }],
    },
  ],
  invalid: [
    // Rename an in-file, non-exported interface + its references.
    {
      code: `interface Props { label: string; }\nexport function Button(props: Props) { return <button>{props.label}</button>; }`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }],
      output: `interface ButtonProps { label: string; }\nexport function Button(props: ButtonProps) { return <button>{props.label}</button>; }`,
    },
    // Type-alias form is renamed too.
    {
      code: `type Props = { label: string };\nexport function Card(props: Props) { return <div>{props.label}</div>; }`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }],
      output: `type CardProps = { label: string };\nexport function Card(props: CardProps) { return <div>{props.label}</div>; }`,
    },
    // Destructured param — the annotation is still renamed.
    {
      code: `interface Props { open: boolean; }\nexport function Modal({ open }: Props) { return <div>{open}</div>; }`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }],
      output: `interface ModalProps { open: boolean; }\nexport function Modal({ open }: ModalProps) { return <div>{open}</div>; }`,
    },
    // Exported type — reported but NOT fixed (renaming would break importers).
    {
      code: `export interface Props { label: string; }\nexport function Button(props: Props) { return <button />; }`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }],
      output: null,
    },
    // Imported type — not declared in file, reported without a fix.
    {
      code: `import type { Props } from './types';\nexport function Button(props: Props) { return <button />; }`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }],
      output: null,
    },
    // Shared props type across two components — reported for both, fixed for neither.
    {
      code: `interface Props { x: string; }\nexport function A(props: Props) { return <a>{props.x}</a>; }\nexport function B(props: Props) { return <b>{props.x}</b>; }`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }, { messageId: 'propsNaming' }],
      output: null,
    },
    // Arrow component assigned to a variable.
    {
      code: `interface Props { n: number; }\nexport const Counter = (props: Props) => <span>{props.n}</span>;`,
      filename: FILE,
      errors: [{ messageId: 'propsNaming' }],
      output: `interface CounterProps { n: number; }\nexport const Counter = (props: CounterProps) => <span>{props.n}</span>;`,
    },
  ],
});
