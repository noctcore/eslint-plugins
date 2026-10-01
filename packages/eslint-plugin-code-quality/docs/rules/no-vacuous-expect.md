# `noctcore-code-quality/no-vacuous-expect`

> A test must assert behaviour that a real regression would break.

<!-- begin generated rule header -->
✅ In `recommended` at `error` · 💭 Type information: not needed
<!-- end generated rule header -->

## Why

Some assertions pass for almost any implementation. `expect(typeof handler).toBe('function')` proves
a binding exists. `expect(true).toBe(true)` cannot fail. A test whose only assertion is
`toBeDefined()` or `toBeTruthy()` stays green when the function returns the wrong object, the wrong
string or the wrong number. These tests add to the count and protect nothing.

The rule matches on method names, not on a runner import, so it covers Jest, Vitest and Bun alike.

## What it flags

- `typeofExpect`: `expect(typeof x).toBe('<typeof result>')`, also with `toEqual`, `toStrictEqual`
  and `.not`.
- `tautologyExpect`: `expect(<literal>).toBe(<same literal>)`, also with `toEqual` / `toStrictEqual`.
- `soleWeakExpect`: a test (`it` / `test`, including `.concurrent`, `.each` and other modifiers)
  whose only assertion is a weak matcher.
- `soleRenderRootExpect`: a test whose only assertion is that the render root is present (see
  below).

```ts bad filename=src/token.test.ts reports=3
it('should be defined', () => {
  expect(service).toBeDefined();
});

it('returns a token', () => {
  expect(typeof issueToken()).toBe('string');
});

it('works', () => {
  expect(true).toBe(true);
});
```

```ts good filename=src/token.test.ts
it('issues a signed token for the user', () => {
  const token = issueToken({ userId: 'u-1' });
  expect(verify(token)).toEqual({ userId: 'u-1' });
});

it('creates the user', () => {
  const user = create({ name: 'ada' });
  expect(user).toBeDefined();
  expect(user.name).toBe('ada');
});

it('clears the key', () => {
  cache.delete('k');
  expect(cache.get('k')).toBeUndefined(); // a specific absence, not a weak check
});
```

### A render root that is only present

A DOM render (Testing Library's `render`) always returns a `container` and a `baseElement`. A test
whose only assertion is that the root, its first child or its HTML exists passes for anything that
renders at all: the wrong component, an empty wrapper, an error boundary's fallback. It is the
"renders without crashing" test with an assertion added to look real.

The subject is a render root, or its `firstChild`, `firstElementChild`, `lastChild`, `innerHTML`,
`outerHTML` or `textContent`. A render root is a name in `renderRoots` that comes from a call:
destructured from one (`const { container } = render(...)`, also after `await`), read off one
(`render(...).container`, `view.container` where `view` is bound to a call, or
`const container = render(...).container`), or returned by a `render*` function
(`const container = renderIntoDocument(...)`). The
matcher is a presence check: `toBeInTheDocument`, `toBeTruthy`, `toBeDefined`, `toBeVisible`,
`not.toBeNull`, `not.toBeUndefined`, `not.toBeFalsy`, `not.toBeEmptyDOMElement`, or `not.toBe('')`
(also `not.toEqual('')` / `not.toStrictEqual('')`).

What the call proves decides which of those presence checks count:

- A `render*` call (`render(...)`, `renderWithProviders(...)`, `rtl.render(...)`, also after
  `await`) proves the root is a DOM node, so every presence check on it counts,
  `expect(container).not.toBeNull()` included.
- Any other call (`setup()`, `mount(Card)`) could return anything, so its root counts only when
  the assertion itself is DOM-specific: the subject reads one of the members above off the root
  (`container.firstChild`), or the matcher exists only for DOM nodes (`toBeInTheDocument`,
  `toBeVisible`, `not.toBeEmptyDOMElement`).

```tsx bad filename=src/TurnstileField.test.tsx reports=3
it('renders without crashing', () => {
  const { container } = render(<TurnstileField form={form} />);
  expect(container).not.toBeEmptyDOMElement();
});

it('renders the card', () => {
  const { container } = render(<Card title="Q3" />);
  expect(container.firstChild).toBeInTheDocument();
});

it('mounts the form', () => {
  const { container } = setup();
  expect(container.firstChild).not.toBeNull();
});
```

```tsx good filename=src/TurnstileField.test.tsx
it('renders the captcha widget', () => {
  render(<TurnstileField form={form} />);
  expect(screen.getByTitle('Captcha challenge')).toBeVisible();
});

it('renders the card', () => {
  render(<Card title="Q3" />);
  expect(screen.getByRole('heading', { name: 'Q3' })).toBeInTheDocument();
});

it('mounts the form', () => {
  setup();
  expect(screen.getByRole('form', { name: 'Sign in' })).toBeVisible();
});
```

## What it does not flag

- A weak matcher next to any other assertion. A test counts every `expect(...)` matcher plus any call
  matching `assertionCallees`, so a weak `expect` next to `assert.equal(...)`, `expectValidUser(...)`
  or supertest's `.expect(200)` is fine.
- `toBeUndefined`, `toBeNull` and `not.toBeNull`, unless you add them to `weakMatchers` (see Options).
- A `container` or `baseElement` that is not bound from a call: a parameter, an object property
  (`ship.container`), or a binding initialised from something other than a `render*` call
  (`const container = await docker.inspect(id)`). A binding assigned later
  (`let container; beforeEach(() => ({ container } = render(...)))`) is not followed either.
- A root from a call that is not a `render*` function, checked with a matcher that says nothing
  about the DOM: `const { container } = await docker.inspect(id); expect(container).not.toBeNull()`
  is accepted, since nothing shows that `container` is a DOM node. A weak matcher there
  (`toBeTruthy`, `toBeDefined`) is still reported, as `soleWeakExpect`. The same goes for a render
  helper whose name does not start with `render`: `const { container } = setup();
  expect(container).not.toBeNull()` is not reported.
- A render root checked for real content (`expect(container.textContent).toBe('Hello')`), a query
  on the root (`container.querySelector('nav')`), or a presence check next to another assertion.

### Limitations

Assertions are counted syntactically inside the test callback. An assertion hidden in a helper whose
name does not match `assertionCallees` is not seen. A sole `toBeTruthy()` on a Testing Library
`getBy*` query is reported even though the query itself throws when the element is missing; assert
with a matcher that states the intent instead.

## Options

| Option | Type | Default | Meaning |
| --- | --- | --- | --- |
| `weakMatchers` | `string[]` | `["toBeDefined", "toBeTruthy", "toBeFalsy", "not.toBeUndefined"]` | Matchers that cannot carry a test alone. Prefix `not.` for the negated form. |
| `assertionCallees` | `string[]` (regex sources) | `["^assert", "^expect\\w", "\\.expect$"]` | Calls that also count as an assertion. Matched against `name`, `obj.name` (member on an identifier) or `.name` (any other member). |
| `renderRoots` | `string[]` | `["container", "baseElement"]` | Names of the render root, as a binding or a member (`view.container`). A sole presence check on one is reported. `[]` turns that check off. |

`toBeUndefined`, `toBeNull` and `not.toBeNull` are not weak by default: each pins one specific
value, and `expect(container.querySelector('nav')).not.toBeNull()` is a real presence check.

```js
// Treat toBeUndefined as weak too, and count a project helper as an assertion.
'noctcore-code-quality/no-vacuous-expect': ['error', {
  weakMatchers: ['toBeDefined', 'toBeTruthy', 'toBeFalsy', 'toBeUndefined'],
  assertionCallees: ['^assert', '^expect\\w', '\\.expect$', '^verifySnapshot$'],
  // A custom mount helper returns its root as `root`.
  renderRoots: ['container', 'baseElement', 'root'],
}]
```

## When not to use it

In a smoke suite whose only purpose is to prove modules load.

## Credits

Based on a rule from [tsforge](https://github.com/boringstack-xyz/tsforge) (MIT). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
