import { ruleTester } from '@noctcore/eslint-test-utils';
import { describe, expect, it } from 'vitest';

import { describeAuthMatchesMiddlewareRule } from '../../src/rules/describe-auth-matches-middleware';

const FILE = 'src/routes.ts';

const MAP = { session: ['requireSession'], apiKey: ['requireApiKey'], public: [] };
const options = [{ map: MAP }] as const;

ruleTester.run('describe-auth-matches-middleware', describeAuthMatchesMiddlewareRule, {
  valid: [
    {
      name: 'bare middleware satisfies the declared kind',
      code: `app.get('/me', describe({ auth: 'session' }), requireSession, handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'called middleware satisfies the declared kind, before the docs call',
      code: `app.get('/me', requireSession(), describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a public route with no middleware',
      code: `app.get('/health', describe({ auth: 'public' }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a middleware listed under its own kind too is allowed',
      code: `app.post('/x', describe({ auth: 'session' }), requireSession, requireApiKey, handler);`,
      filename: FILE,
      options: [
        { map: { session: ['requireSession', 'requireApiKey'], apiKey: ['requireApiKey'] } },
      ],
    },
    {
      name: 'a list holds alternatives, so one name is enough',
      code: `app.get('/me', describe({ auth: 'session' }), requireApiKey, handler);`,
      filename: FILE,
      options: [{ map: { session: ['requireSession', 'requireApiKey'] } }],
    },
    {
      name: 'inert with an empty options object',
      code: `app.get('/me', describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options: [{}],
    },
    {
      name: 'inert with an empty map',
      code: `app.get('/me', describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options: [{ map: {} }],
    },
    {
      name: 'a route with no docs call is not judged',
      code: `app.get('/me', requireApiKey, handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a non-literal kind is skipped (identifier value)',
      code: `app.get('/me', describe({ auth: kind }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a non-literal kind is skipped (shorthand)',
      code: `app.get('/me', describe({ auth }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a docs call without an object argument is skipped',
      code: `app.get('/me', describe(meta), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'middleware named in no map entry is ignored',
      code: `app.get('/me', describe({ auth: 'session' }), requireSession, logger, handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a spread argument makes the chain unknowable',
      code: `app.get('/me', describe({ auth: 'public' }), ...mws, requireSession, handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a non-string path is not a route call',
      code: `app.get(path, describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a template path with an expression is not a route call',
      code: 'app.get(`/me/${id}`, describe({ auth: \'session\' }), handler);',
      filename: FILE,
      options,
    },
    {
      name: 'a method outside the route set is not read',
      code: `app.head('/me', describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'a test-runner describe outside any route call is not a docs call',
      code: `describe('routes', () => { it('works', () => {}); });`,
      filename: FILE,
      options,
    },
    {
      name: 'a docs call in the handler position is not read',
      code: `app.get('/me', describe({ auth: 'session' }));`,
      filename: FILE,
      options,
    },
    {
      name: 'a renamed docs call is ignored under the default docsCallee',
      code: `app.get('/me', openapi({ security: 'session' }), handler);`,
      filename: FILE,
      options,
    },
    {
      name: 'the default docs call is ignored once docsCallee is renamed',
      code: `app.get('/me', describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options: [{ map: MAP, docsCallee: 'openapi', authProperty: 'security' }],
    },
  ],
  invalid: [
    {
      name: 'a session route without session middleware',
      code: `app.get('/me', describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingMiddleware', data: { kind: 'session', expected: '`requireSession`' } }],
    },
    {
      name: 'a public route carrying session middleware',
      code: `app.get('/health', describe({ auth: 'public' }), requireSession, handler);`,
      filename: FILE,
      options,
      errors: [
        {
          messageId: 'foreignMiddleware',
          data: { middleware: 'requireSession', kind: 'public', otherKinds: '`session`' },
        },
      ],
    },
    {
      name: 'a session route carrying api key middleware',
      code: `app.post('/x', describe({ auth: 'session' }), requireSession, requireApiKey, handler);`,
      filename: FILE,
      options,
      errors: [
        {
          messageId: 'foreignMiddleware',
          data: { middleware: 'requireApiKey', kind: 'session', otherKinds: '`apiKey`' },
        },
      ],
    },
    {
      name: 'foreign middleware and missing middleware are both reported',
      code: `app.put('/x', describe({ auth: 'session' }), requireApiKey, handler);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingMiddleware' }, { messageId: 'foreignMiddleware' }],
    },
    {
      name: 'a mistyped kind is reported as unknown',
      code: `app.get('/me', describe({ auth: 'sesion' }), handler);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unknownKind', data: { kind: 'sesion' } }],
    },
    {
      name: 'a prototype property name is an unknown kind, not a lookup hit',
      code: `app.get('/me', describe({ auth: 'toString' }), handler);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'unknownKind', data: { kind: 'toString' } }],
    },
    {
      name: 'a configured docsCallee and authProperty are read',
      code: `app.get('/me', openapi({ security: 'session' }), handler);`,
      filename: FILE,
      options: [{ map: MAP, docsCallee: 'openapi', authProperty: 'security' }],
      errors: [{ messageId: 'missingMiddleware' }],
    },
    {
      name: 'a dotted docsCallee is matched exactly',
      code: `app.get('/me', docs.describe({ auth: 'session' }), handler);`,
      filename: FILE,
      options: [{ map: MAP, docsCallee: 'docs.describe' }],
      errors: [{ messageId: 'missingMiddleware' }],
    },
    {
      name: 'a string-keyed auth property is read',
      code: `app.get('/me', describe({ 'auth': 'session' }), handler);`,
      filename: FILE,
      options,
      errors: [{ messageId: 'missingMiddleware' }],
    },
  ],
});

describe('describe-auth-matches-middleware meta', () => {
  const meta = describeAuthMatchesMiddlewareRule.meta;
  const schema = (Array.isArray(meta.schema) ? meta.schema[0] : meta.schema) as {
    required?: string[];
    properties: {
      docsCallee: { description: string };
      authProperty: { description: string };
      map: { description: string; additionalProperties: { description: string } };
    };
  };

  it('needs options', () => {
    expect(meta.docs?.requiresOptions).toBe(true);
  });

  it('requires no option', () => {
    expect(schema.required).toBeUndefined();
  });

  it('describes every option', () => {
    expect(schema.properties.docsCallee.description).not.toBe('');
    expect(schema.properties.authProperty.description).not.toBe('');
    expect(schema.properties.map.description).not.toBe('');
    expect(schema.properties.map.additionalProperties.description).not.toBe('');
  });
});
