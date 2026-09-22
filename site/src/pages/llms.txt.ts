/**
 * Emits dist/llms.txt at the site root, pointing agents at rules.json and the
 * all-rules page. Format per https://llmstxt.org.
 */
import type { APIRoute } from 'astro';

import { buildLlmsTxt, buildRulesIndex } from '../lib/rules-index';

export const GET: APIRoute = () =>
  new Response(buildLlmsTxt(buildRulesIndex()), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
