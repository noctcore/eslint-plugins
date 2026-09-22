/**
 * Emits dist/rules.json, served at /eslint-plugins/rules.json. The shape is
 * defined and documented in src/lib/rules-index.ts.
 */
import type { APIRoute } from 'astro';

import { buildRulesIndex } from '../lib/rules-index';

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildRulesIndex(), null, 2)}\n`, {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
