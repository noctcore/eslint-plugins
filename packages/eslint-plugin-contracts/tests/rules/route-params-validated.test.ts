import { ruleTester } from '@noctcore/eslint-test-utils';

import { routeParamsValidatedRule } from '../../src/rules/route-params-validated';

const FILE = 'src/routes.ts';

const unvalidated = (path: string, params: string) =>
  [{ messageId: 'unvalidatedParams' as const, data: { path, params } }];

ruleTester.run('route-params-validated', routeParamsValidatedRule, {
  valid: [
    // chain and path
    {
      code: `const app = new Hono(); app.get('/calls/:id', signedInOnly, param(CallIdSchema), async (c) => {});`,
      filename: FILE,
    },
    { code: `const app = new Hono(); app.get('/calls', signedInOnly, async (c) => {});`, filename: FILE },
    // validators
    { code: `const app = new Hono(); app.get('/calls/:id', zValidator('param', S), h);`, filename: FILE },
    { code: `const app = new Hono(); app.get('/calls/:id', validator('param', fn), h);`, filename: FILE },
    { code: `const app = new Hono(); app.get('/calls/:id', v.param(S), h);`, filename: FILE },
    {
      code: `const app = new Hono(); app.get('/calls/:id', validateParams(S), h);`,
      filename: FILE,
      options: [{ validators: ['validateParams'] }],
    },
    {
      code: `const app = new Hono(); app.get('/calls/:id', sValidator('param', S), h);`,
      filename: FILE,
      options: [{ validatorFactories: ['sValidator'] }],
    },
    // router detection: not routers
    { code: `const app = new Hono(); axios.get('/users/:id', config);`, filename: FILE },
    { code: `const app = new Hono(); map.get(':id');`, filename: FILE },
    { code: `const app = new Hono(); router.get('/:id', h);`, filename: FILE },
    { code: `import { app } from './app'; app.get('/x/:id', h);`, filename: FILE },
    { code: `const app = new Hono(); app[m]('/x/:id', h);`, filename: FILE },
    { code: `const app = new Hono(); app.get(path, h);`, filename: FILE },
    { code: 'const app = new Hono(); app.get(`/x/${id}`, h);', filename: FILE },
    { code: `const router = express.Router(); router.get('/:id', h);`, filename: FILE },
    { code: `let app = new Hono(); app.get('/x/:id', h);`, filename: FILE },
    { code: `const app = new Hono(); app.get('/x/id', h);`, filename: FILE },
    // use
    {
      code: `const app = new Hono(); app.use('/calls/:id/*', param(S)); app.get('/calls/:id', h);`,
      filename: FILE,
    },
    {
      code: `const app = new Hono(); app.get('/calls/:id', h); app.use('/calls/:id/*', param(S));`,
      filename: FILE,
    },
  ],
  invalid: [
    {
      code: `const app = new Hono<Env>(); app.get('/calls/:id', signedInOnly, async (c) => {});`,
      filename: FILE,
      errors: [{ messageId: 'unvalidatedParams', data: { path: '/calls/:id', params: '`id`' } }],
    },
    {
      code: `const app = new Hono<Env>(); app.post('/calls/:id', signedInOnly, async (c) => {});`,
      filename: FILE,
      errors: [{ messageId: 'unvalidatedParams', data: { path: '/calls/:id', params: '`id`' } }],
    },
    {
      code: `const app = new Hono<Env>(); app.put('/calls/:id', signedInOnly, async (c) => {});`,
      filename: FILE,
      errors: [{ messageId: 'unvalidatedParams', data: { path: '/calls/:id', params: '`id`' } }],
    },
    {
      code: `const app = new Hono<Env>(); app.patch('/calls/:id', signedInOnly, async (c) => {});`,
      filename: FILE,
      errors: [{ messageId: 'unvalidatedParams', data: { path: '/calls/:id', params: '`id`' } }],
    },
    {
      code: `const app = new Hono<Env>(); app.delete('/calls/:id', signedInOnly, async (c) => {});`,
      filename: FILE,
      errors: [{ messageId: 'unvalidatedParams', data: { path: '/calls/:id', params: '`id`' } }],
    },
    {
      code: `const app = new Hono<Env>(); app.all('/calls/:id', signedInOnly, async (c) => {});`,
      filename: FILE,
      errors: [{ messageId: 'unvalidatedParams', data: { path: '/calls/:id', params: '`id`' } }],
    },
    {
      code: `const app = new Hono(); app.get('/orgs/:org/calls/:id', h);`,
      filename: FILE,
      errors: unvalidated('/orgs/:org/calls/:id', '`org`, `id`'),
    },
    {
      code: `const app = new Hono(); app.get('/calls/:id?', h); app.get('/n/:n{[0-9]+}', h);`,
      filename: FILE,
      errors: [
        ...unvalidated('/calls/:id?', '`id`'),
        ...unvalidated('/n/:n{[0-9]+}', '`n`'),
      ],
    },
    {
      code: 'const app = new Hono(); app.get(`/calls/:id`, h);',
      filename: FILE,
      errors: unvalidated('/calls/:id', '`id`'),
    },
    // validators
    {
      code: `const app = new Hono(); app.get('/calls/:id', zValidator('json', S), h);`,
      filename: FILE,
      errors: unvalidated('/calls/:id', '`id`'),
    },
    {
      code: `const app = new Hono(); app.get('/calls/:id', param(S), h);`,
      filename: FILE,
      options: [{ validators: ['validateParams'] }],
      errors: unvalidated('/calls/:id', '`id`'),
    },
    {
      code: `const app = new Hono(); app.get('/calls/:id', zValidator('param', S), h);`,
      filename: FILE,
      options: [{ validatorFactories: ['sValidator'] }],
      errors: unvalidated('/calls/:id', '`id`'),
    },
    // router detection
    {
      code: `const app = new Hono().basePath('/v1'); app.get('/x/:id', h);`,
      filename: FILE,
      errors: unvalidated('/x/:id', '`id`'),
    },
    {
      code: `const app = new Hono(); app.get('/a', h).post('/b/:id', h);`,
      filename: FILE,
      errors: unvalidated('/b/:id', '`id`'),
    },
    {
      code: `new Hono().get('/x/:id', h);`,
      filename: FILE,
      errors: unvalidated('/x/:id', '`id`'),
    },
    {
      code: `const app = new Hono() as AppType; app.get('/x/:id', h);`,
      filename: FILE,
      errors: unvalidated('/x/:id', '`id`'),
    },
    {
      code: `router.get('/:id', h);`,
      filename: FILE,
      options: [{ routerNames: ['router'] }],
      errors: unvalidated('/:id', '`id`'),
    },
    // use
    {
      code: `const app = new Hono(); app.use(logger()); app.get('/calls/:id', h);`,
      filename: FILE,
      errors: unvalidated('/calls/:id', '`id`'),
    },
    {
      code: `const app = new Hono(); const other = new Hono(); other.use(param(S)); app.get('/calls/:id', h);`,
      filename: FILE,
      errors: unvalidated('/calls/:id', '`id`'),
    },
  ],
});
