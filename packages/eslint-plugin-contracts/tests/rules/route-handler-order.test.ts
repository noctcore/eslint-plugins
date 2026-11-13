import { ruleTester } from '@noctcore/eslint-test-utils';
import { describe, expect, it } from 'vitest';

import { routeHandlerOrderRule } from '../../src/rules/route-handler-order';

const FILE = 'src/routes.ts';

const GROUPS = [
  { name: 'docs', callees: ['describe'] },
  { name: 'auth', callees: ['signedInOnly'] },
  { name: 'validate', callees: ['body'] },
];

const options = [{ groups: GROUPS }] as const;

ruleTester.run('route-handler-order', routeHandlerOrderRule, {
  valid: [
    { code: `app.post('/x', describe(d), signedInOnly, body(S), handler);`, filename: FILE, options },
    {
      code: `app.post('/x', describe(d), logger, signedInOnly, body(S), handler);`,
      filename: FILE,
      options,
    },
    { code: `app.post('/x', body(S), signedInOnly);`, filename: FILE, options },
    { code: `app.head('/x', body(S), signedInOnly, handler);`, filename: FILE, options },
    { code: `app['post']('/x', body(S), signedInOnly, handler);`, filename: FILE, options },
    { code: `app.post(path, body(S), signedInOnly, handler);`, filename: FILE, options },
    { code: 'app.post(`/x/${id}`, body(S), signedInOnly, handler);', filename: FILE, options },
    { code: `app.post('/x', body(S));`, filename: FILE, options },
    { code: `map.get('k');`, filename: FILE, options },
    { code: `client.post('/x', body);`, filename: FILE, options },
    {
      code: `app.post('/x', body(S), signedInOnly, describe(d), handler);`,
      filename: FILE,
      options: [{ groups: [] }],
    },
    {
      code: `app.post('/x', v.body(S), signedInOnly, handler);`,
      filename: FILE,
      options: [
        {
          groups: [
            { name: 'auth', callees: ['signedInOnly'] },
            { name: 'validate', callees: ['body'] },
          ],
        },
      ],
    },
    {
      code: `app.post('/x', ...mws, signedInOnly, (c) => c.json({}));`,
      filename: FILE,
      options,
    },
  ],
  invalid: [
    {
      code: `app.post('/x', body(S), signedInOnly, describe(d), handler);`,
      filename: FILE,
      options,
      errors: [
        {
          messageId: 'outOfOrder',
          data: { argument: 'signedInOnly', group: 'auth', laterGroup: 'validate' },
        },
        {
          messageId: 'outOfOrder',
          data: { argument: 'describe', group: 'docs', laterGroup: 'validate' },
        },
      ],
    },
    {
      code: `app.post('/x', body(S), logger, signedInOnly, handler);`,
      filename: FILE,
      options,
      errors: [
        {
          messageId: 'outOfOrder',
          data: { argument: 'signedInOnly', group: 'auth', laterGroup: 'validate' },
        },
      ],
    },
    {
      code: 'app.post(`/x`, body(S), signedInOnly, handler);',
      filename: FILE,
      options,
      errors: [{ messageId: 'outOfOrder' }],
    },
    {
      code: `app.post('/x', v.body(S), auth.signedIn, handler);`,
      filename: FILE,
      options: [
        {
          groups: [
            { name: 'auth', callees: ['auth.signedIn'] },
            { name: 'validate', callees: ['v.body'] },
          ],
        },
      ],
      errors: [
        {
          messageId: 'outOfOrder',
          data: { argument: 'auth.signedIn', group: 'auth', laterGroup: 'validate' },
        },
      ],
    },
    {
      code: `app.post('/x', signedInOnly, x, handler);`,
      filename: FILE,
      options: [
        {
          groups: [
            { name: 'docs', callees: ['x'] },
            { name: 'auth', callees: ['signedInOnly', 'x'] },
          ],
        },
      ],
      errors: [
        {
          messageId: 'outOfOrder',
          data: { argument: 'x', group: 'docs', laterGroup: 'auth' },
        },
      ],
    },
  ],
});

describe('route-handler-order meta', () => {
  const meta = routeHandlerOrderRule.meta;
  const schema = (Array.isArray(meta.schema) ? meta.schema[0] : meta.schema) as {
    required: string[];
    properties: {
      groups: {
        description: string;
        items: {
          required: string[];
          properties: {
            name: { description: string };
            callees: { description: string; minItems: number };
          };
        };
      };
    };
  };

  it('needs options', () => {
    expect(meta.docs?.requiresOptions).toBe(true);
  });

  it('requires groups, each with a name and non-empty callees', () => {
    expect(schema.required).toContain('groups');
    expect(schema.properties.groups.items.required).toEqual(['name', 'callees']);
    expect(schema.properties.groups.items.properties.callees.minItems).toBe(1);
  });

  it('describes every option', () => {
    expect(schema.properties.groups.description).not.toBe('');
    expect(schema.properties.groups.items.properties.name.description).not.toBe('');
    expect(schema.properties.groups.items.properties.callees.description).not.toBe('');
  });
});
