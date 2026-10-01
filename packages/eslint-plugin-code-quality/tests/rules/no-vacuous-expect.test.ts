import { ruleTester } from '@noctcore/eslint-test-utils';

import { noVacuousExpectRule } from '../../src/rules/no-vacuous-expect';

ruleTester.run('no-vacuous-expect', noVacuousExpectRule, {
  valid: [
    { code: "it('adds', () => { expect(add(1, 2)).toBe(3); });" },
    // A weak matcher is fine next to a real assertion.
    {
      code: `
        it('creates', () => {
          const user = create();
          expect(user).toBeDefined();
          expect(user.name).toBe('ada');
        });
      `,
    },
    // `toBeUndefined` pins a specific absence, so it is not weak by default.
    { code: "it('clears', () => { cache.clear(); expect(cache.get('k')).toBeUndefined(); });" },
    // A weak expect paired with a non-expect assertion.
    {
      code: `
        it('responds', async () => {
          expect(app).toBeTruthy();
          await request(app).get('/health').expect(200);
        });
      `,
    },
    { code: "test('asserts', () => { expect(result).toBeDefined(); assert.equal(result.id, 1); });" },
    { code: "test('helper', () => { expect(user).toBeTruthy(); expectValidUser(user); });" },
    // Negated tautology always fails; it is broken, not vacuous.
    { code: "it('x', () => { expect(1).not.toBe(1); });" },
    // `not.toBeNull` on a DOM query pins presence; not weak by default.
    { code: "it('renders', () => { expect(container.querySelector('nav')).not.toBeNull(); });" },
    // Outside a test callback the sole-weak check does not apply.
    { code: 'const check = () => expect(value).toBeDefined();' },
    // Configured: only `toBeDefined` is weak.
    {
      code: "it('truthy', () => { expect(isReady()).toBeTruthy(); });",
      options: [{ weakMatchers: ['toBeDefined'] }],
    },
    // A render root assertion on real content pins behaviour.
    {
      code: "it('greets', () => { const { container } = render(<Hello />); expect(container.textContent).toBe('Hello'); });",
      filename: 'src/Hello.test.tsx',
    },
    {
      code: "it('renders', () => { const { container } = render(<Nav />); expect(container.querySelector('nav')).toBeInTheDocument(); });",
      filename: 'src/Nav.test.tsx',
    },
    // A presence check next to a real assertion.
    {
      code: `
        it('renders the field', () => {
          const { container } = render(<Harness />);
          expect(container).not.toBeEmptyDOMElement();
          expect(screen.getByRole('textbox', { name: 'Captcha' })).toBeVisible();
        });
      `,
      filename: 'src/TurnstileField.test.tsx',
    },
    // A screen query is not the render root.
    { code: "it('shows', () => { render(<Hello />); expect(screen.getByText('Hello')).toBeInTheDocument(); });", filename: 'src/Hello.test.tsx' },
    // A `container` that is not a render result is not a render root.
    {
      code: "it('inspects', async () => { const container = await docker.inspect(id); expect(container).not.toBeNull(); });",
    },
    { code: "it('ships', () => { expect(ship.container).toBeVisible(); });" },
    { code: "it('loads', () => { const { container } = fixtures; expect(container).not.toBeEmptyDOMElement(); });" },
    { code: "it('packs', ({ container }) => { expect(container).not.toBeEmptyDOMElement(); });" },
    // A root from a call that is not a `render*` function, checked with a generic matcher, is
    // not known to be a DOM node.
    {
      code: "it('inspects', async () => { const { container } = await docker.inspect(id); expect(container).not.toBeNull(); });",
    },
    {
      code: "it('inspects', async () => { const info = await docker.inspect(id); expect(info.container).not.toBeNull(); });",
    },
    {
      code: "it('inspects', async () => { expect((await docker.inspect(id)).container).not.toBeFalsy(); });",
    },
    {
      code: "it('mounts', () => { const { container } = setup(); expect(container).not.toBeNull(); });",
      filename: 'src/Card.test.tsx',
    },
    // renderRoots: [] turns the render-root check off.
    {
      code: "it('renders', () => { const { container } = render(<Harness />); expect(container).not.toBeEmptyDOMElement(); });",
      filename: 'src/TurnstileField.test.tsx',
      options: [{ renderRoots: [] }],
    },
  ],
  invalid: [
    {
      code: "it('exists', () => { expect(service).toBeDefined(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeDefined' } }],
    },
    {
      code: "test('ok', async () => { expect(await load()).toBeTruthy(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeTruthy' } }],
    },
    {
      code: "it('present', () => { expect(value).not.toBeUndefined(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'not.toBeUndefined' } }],
    },
    // Runner modifiers and `each` tables are still tests.
    {
      code: "it.concurrent('exists', () => { expect(x).toBeDefined(); });",
      errors: [{ messageId: 'soleWeakExpect' }],
    },
    {
      code: "test.each([1, 2])('case %i', (n) => { expect(f(n)).toBeTruthy(); });",
      errors: [{ messageId: 'soleWeakExpect' }],
    },
    {
      code: "it('fn', () => { expect(typeof handler).toBe('function'); });",
      errors: [{ messageId: 'typeofExpect' }],
    },
    {
      code: "it('fn', () => { expect(typeof handler).not.toEqual('undefined'); expect(handler()).toBe(1); });",
      errors: [{ messageId: 'typeofExpect' }],
    },
    {
      code: "it('true', () => { expect(true).toBe(true); });",
      errors: [{ messageId: 'tautologyExpect' }],
    },
    {
      code: "it('lit', () => { expect('a').toStrictEqual('a'); expect(run()).toBe(2); });",
      errors: [{ messageId: 'tautologyExpect' }],
    },
    // Configured: `toBeUndefined` added back as weak.
    {
      code: "it('gone', () => { expect(cache.get('k')).toBeUndefined(); });",
      options: [{ weakMatchers: ['toBeUndefined'] }],
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeUndefined' } }],
    },
    // Configured: no extra assertion callees, so `assert.ok` no longer rescues the test.
    {
      code: "it('x', () => { expect(x).toBeDefined(); assert.ok(x.id); });",
      options: [{ assertionCallees: [] }],
      errors: [{ messageId: 'soleWeakExpect' }],
    },
    // Settly shape: a smoke-only render test.
    {
      code: `
        describe('TurnstileField', () => {
          it('renders without crashing', () => {
            const { container } = render(<Harness />);
            expect(container).not.toBeEmptyDOMElement();
          });
        });
      `,
      filename: 'src/TurnstileField.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'not.toBeEmptyDOMElement' } }],
    },
    {
      code: "it('renders', () => { const { container } = render(<Card />); expect(container.firstChild).toBeInTheDocument(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'toBeInTheDocument' } }],
    },
    {
      code: "it('renders', () => { const { container } = render(<Card />); expect(container.innerHTML).not.toBe(''); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'not.toBe' } }],
    },
    {
      code: "it('renders', () => { const view = render(<Card />); expect(view.baseElement).toBeInTheDocument(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect' }],
    },
    // A weak matcher on the root reports as a render-root smoke, once.
    {
      code: "it('renders', () => { expect(render(<Card />).container.firstChild).toBeTruthy(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'toBeTruthy' } }],
    },
    // Render results through await, a member of the result, and a render* helper.
    {
      code: "it('renders', async () => { const { container } = await renderAsync(<Card />); expect(container).toBeInTheDocument(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect' }],
    },
    {
      code: "it('renders', () => { const container = render(<Card />).container; expect(container.innerHTML).not.toEqual(''); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect' }],
    },
    {
      code: "it('renders', () => { const container = renderIntoDocument(<Card />); expect(container).not.toBeEmptyDOMElement(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect' }],
    },
    // A `render*` call proves the root, so a generic presence matcher on it is a smoke test.
    {
      code: "it('renders', () => { const { container } = render(<Card />); expect(container).not.toBeNull(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'not.toBeNull' } }],
    },
    // A root from any other call counts when the assertion itself is DOM-specific: a DOM-only
    // matcher, or a DOM member read off the root.
    {
      code: "it('mounts', () => { const { container } = setup(); expect(container).toBeInTheDocument(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'toBeInTheDocument' } }],
    },
    {
      code: "it('mounts', () => { const { container } = setup(); expect(container.firstChild).not.toBeNull(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'not.toBeNull' } }],
    },
    {
      code: "it('mounts', () => { const view = setup(); expect(view.container).toBeVisible(); });",
      filename: 'src/Card.test.tsx',
      errors: [{ messageId: 'soleRenderRootExpect', data: { matcher: 'toBeVisible' } }],
    },
    // Without that evidence a weak matcher on the same binding is still a sole weak expect.
    {
      code: "it('inspects', async () => { const { container } = await docker.inspect(id); expect(container).toBeTruthy(); });",
      errors: [{ messageId: 'soleWeakExpect', data: { matcher: 'toBeTruthy' } }],
    },
    // A custom root name.
    {
      code: "it('mounts', () => { const { root } = mount(Card); expect(root).toBeInTheDocument(); });",
      filename: 'src/Card.test.ts',
      options: [{ renderRoots: ['root'] }],
      errors: [{ messageId: 'soleRenderRootExpect' }],
    },
  ],
});
