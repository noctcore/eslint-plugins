import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

// src/content/docs/rules/** is written by scripts/sync.ts from the rule docs
// under packages/*/docs/rules/ and is gitignored; everything else is authored.
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
