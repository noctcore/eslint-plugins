# `noctcore-code-quality/no-elided-code-comments`

> Ban `// ... existing code ...` placeholders that stand in for deleted code.

## Why

When an agent rewrites a file from an abbreviated draft, it writes placeholders like
`// ... existing code ...` or `// rest of the function unchanged` where it skipped code. If the edit
is applied as a whole-file write instead of a patch, the placeholder lands in the file and the code
it stood for is gone. The file still parses and often still type-checks, so nothing else notices:
a method disappears, a `case` goes missing, and the only trace is a comment claiming nothing
changed. VS Code's agent mode shipped with this failure
([microsoft/vscode#254789](https://github.com/microsoft/vscode/issues/254789)).

The comment is a strong signal on its own. Nobody writes "rest of the code unchanged" on purpose in
a file they are keeping.

## What it flags

Line and block comments (JSDoc `/** … */` blocks are exempt, `@example` code included) whose whole
text is an elision placeholder, matched case-insensitively and with `...` or `…` allowed around it:

- A reference to left-out code: `rest of the code`, `rest of the function unchanged`,
  `... existing code ...`, `... other methods ...`, `other handlers omitted for brevity`,
  `keep existing imports ...`. The generic forms ("other methods", "more tests") only count with
  an ellipsis or a word such as `unchanged`, `omitted`, `here` or `as before`, because on their own
  they read as section headers. Data nouns (`fields`, `props`, `state`, `config`, …) need more:
  `omitted` / `here` / `for brevity`, or ellipses on both sides (`// ... other props ...`), since
  a test that writes `// other fields unchanged` above its assertions is describing data, not
  skipping code.
- A fill-in placeholder: `your code here`, `add your own logic here`, `implementation goes here`.
- A claim that the rest did not change: `everything else stays the same`, `(unchanged)`,
  `... same as before`.

```ts bad reports=3
class Cart {
  add(item: Item) {
    this.items.push(item);
  }

  // ... other methods ...
}

function total(cart: Cart) {
  /* rest of the function unchanged */
}

function checkout() {
  // your code here
}
```

```ts good
class Cart {
  add(item: Item) {
    this.items.push(item);
  }

  remove(id: string) {
    this.items = this.items.filter((item) => item.id !== id);
  }
}

// Other helpers
function total(cart: Cart) {
  return cart.items.reduce((sum, item) => sum + item.price, 0);
}
```

It is deliberately narrow: the comment has to be the placeholder and nothing else. An ellipsis in
prose (`// wait... this is intentional`), commented-out spread syntax (`// return { ...rest }`),
a bare `/* ... */`, a sentence that happens to say "the rest of the function assumes…", and a
plain `// unchanged` note next to a value are all left alone. So are comments that start with
`TODO`, `FIXME`, `XXX` or `HACK`: a tracked placeholder is a known gap, not a silent deletion.

```ts good
function sum(values: number[]) {
  // wait... this is intentional: an empty list sums to zero.
  // The rest of the function assumes the list is sorted.
  return values.reduce((total, value) => total + value, 0);
}

const next = {
  ...previous,
  // unchanged
  retries: 3,
};

// TODO: implementation goes here
```

## How to fix

Restore the missing code from version control (`git diff` shows what the edit removed), then delete
the comment. If the code really was meant to go, delete the comment alone.

## Options

None.

## When not to use it

In documentation or code-generation templates where a `// your code here` placeholder is the
intended output. Disable it for those files.
