/**
 * The hand-drawn diagrams under packages/<pkg>/docs/diagrams/ (see
 * CONTRIBUTING.md, "Rule page template", Diagrams).
 *
 * - Every drawing is referenced (a rule doc image line or a RuleDiagram on a
 *   package page), and every reference names a drawing that exists.
 * - Each wide drawing has a narrow twin, and every drawing carries the same
 *   shared <style> block, so GitHub renders them alike.
 * - Every class a drawing uses is styled in components.css, so the site,
 *   which strips the drawing's own style, colours all of it.
 * - No ids (two inlined drawings on one page would collide), no em or en
 *   dashes, and no text outside the viewBox.
 * - The facts a drawing states match the rule source: names, defaults and
 *   option keys come from the rules' meta, not from memory.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { DIAGRAM_IMAGE, inlineSvg } from '../src/lib/diagrams';
import { REPO_ROOT, listRuleDocs, loadRuleDetails } from './inventory';
import { RULE_PAGE_PACKAGES } from './structure';

const details = await loadRuleDetails('src');
const CSS = readFileSync(join(REPO_ROOT, 'site/src/styles/components.css'), 'utf8');
const PAGES = join(REPO_ROOT, 'site/src/content/docs/packages');

interface Drawing {
  readonly pkg: string;
  readonly name: string;
  readonly path: string;
  readonly source: string;
}

const drawings: Drawing[] = RULE_PAGE_PACKAGES.flatMap((pkg) => {
  const dir = join(REPO_ROOT, 'packages', `eslint-plugin-${pkg}`, 'docs', 'diagrams');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith('.svg'))
    .map((file) => ({
      pkg,
      name: file.slice(0, -'.svg'.length),
      path: join(dir, file),
      source: readFileSync(join(dir, file), 'utf8'),
    }));
});

const wide = drawings.filter((d) => !d.name.endsWith('.narrow'));
const byName = new Map(drawings.map((d) => [`${d.pkg}/${d.name}`, d]));
const textOf = (svg: string) =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!.replaceAll('&gt;', '>').replaceAll('&lt;', '<'));
const styleOf = (svg: string) => /<style>[\s\S]*?<\/style>/.exec(svg)?.[0] ?? null;

/** Every drawing a rule doc or a package page points at, as `<pkg>/<name>`. */
function references(): string[] {
  const refs: string[] = [];
  for (const doc of listRuleDocs()) {
    if (!RULE_PAGE_PACKAGES.includes(doc.short)) continue;
    for (const line of readFileSync(doc.path, 'utf8').split('\n')) {
      const m = DIAGRAM_IMAGE.exec(line);
      if (m) refs.push(`${doc.short}/${basename(resolve(dirname(doc.path), m[2]!), '.svg')}`);
    }
  }
  for (const file of readdirSync(PAGES)) {
    const page = readFileSync(join(PAGES, file), 'utf8');
    for (const m of page.matchAll(/<RuleDiagram\s[^>]*?pkg="([^"]+)"[^>]*?name="([^"]+)"/g)) refs.push(`${m[1]}/${m[2]}`);
  }
  return refs;
}

describe('diagram files', () => {
  test('the pilot package has drawings', () => {
    expect(wide.length).toBeGreaterThan(0);
  });

  test('every drawing is referenced, and every reference exists', () => {
    const refs = references();
    expect(refs.filter((ref) => !byName.has(ref))).toEqual([]);
    expect(wide.map((d) => `${d.pkg}/${d.name}`).filter((key) => !refs.includes(key))).toEqual([]);
  });

  test('every wide drawing has a narrow twin', () => {
    expect(wide.filter((d) => !byName.has(`${d.pkg}/${d.name}.narrow`)).map((d) => d.name)).toEqual([]);
  });

  test('every drawing carries the same shared style block', () => {
    const styles = new Set(drawings.map((d) => styleOf(d.source)));
    expect(styles.has(null)).toBe(false);
    expect(styles.size).toBe(1);
  });

  test('every class a drawing uses is styled by the site', () => {
    const used = new Set(drawings.flatMap((d) => [...d.source.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(/\s+/))));
    const missing = [...used].filter((cls) => !new RegExp(`\\.rule-diagram[^{]*\\.${cls}\\b`).test(CSS));
    expect(missing).toEqual([]);
  });

  test('no ids, no em or en dashes, no stray colours', () => {
    for (const d of drawings) {
      const body = d.source.replace(/<style>[\s\S]*?<\/style>/, '');
      expect({ name: d.name, id: /\sid="/.test(d.source) }).toEqual({ name: d.name, id: false });
      expect({ name: d.name, dash: /[\u2013\u2014]/.test(d.source) }).toEqual({ name: d.name, dash: false });
      expect({ name: d.name, inline: /\s(fill|stroke|style)="/.test(body) }).toEqual({ name: d.name, inline: false });
    }
  });

  test('text sits inside the viewBox', () => {
    for (const d of drawings) {
      const [, , w, h] = /viewBox="([\d. ]+)"/.exec(d.source)![1]!.split(' ').map(Number);
      for (const m of d.source.matchAll(/<text[^>]*\sx="([\d.]+)"[^>]*\sy="([\d.]+)"/g)) {
        const [x, y] = [Number(m[1]), Number(m[2])];
        expect({ name: d.name, x, y, inside: x >= 0 && x < w! && y > 8 && y <= h! }).toEqual({ name: d.name, x, y, inside: true });
      }
    }
  });

  test('the inliner refuses markup that survives stripping', () => {
    expect(() => inlineSvg('<svg><sc<!-- x -->ript>alert(1)</script></svg>', 'x', 'wide')).toThrow('may not');
    expect(() => inlineSvg('<svg><rect onclick="x"/></svg>', 'x', 'wide')).toThrow('may not');
    expect(inlineSvg('<svg><!-<!-- a -->- b --></svg>', 'x', 'wide')).not.toContain('<!--');
  });

  test('the site inlines a drawing without its style, ids or size', () => {
    const svg = inlineSvg(drawings[0]!.source, drawings[0]!.name, 'wide');
    expect(svg).not.toContain('<style');
    expect(/^<svg[^>]*>/.exec(svg)![0]).not.toMatch(/\s(width|height)="/);
    expect(svg).toContain('aria-hidden="true"');
  });
});

describe('diagram facts match the rule source', () => {
  const both = (name: string) => [byName.get(`architecture/${name}`)!, byName.get(`architecture/${name}.narrow`)!];
  const defaults = (rule: string) => (details.get(`architecture/${rule}`)!.defaults ?? {}) as Record<string, unknown>;

  test('the overview names every rule of the package, once per drawing', () => {
    const rules = [...details.keys()].filter((key) => key.startsWith('architecture/')).map((key) => key.split('/')[1]!);
    expect(rules.length).toBe(10);
    for (const d of both('overview')) {
      const labels = textOf(d.source);
      for (const rule of rules) expect({ rule, count: labels.filter((t) => t === rule).length }).toEqual({ rule, count: 1 });
    }
  });

  test('feature boundaries shows the default feature root and shared feature', () => {
    const { featureRoot, sharedFeatures } = defaults('no-cross-feature-imports');
    for (const d of both('feature-boundaries')) {
      const text = textOf(d.source).join('\n');
      expect(text).toContain(`src/${featureRoot as string}/`);
      for (const shared of sharedFeatures as string[]) expect(text).toContain(`${shared}/`);
      expect(text).toContain('crossFeatureImport');
    }
  });

  test('import depth draws the default max and reports one hop past it', () => {
    const { max } = defaults('max-import-depth');
    for (const d of both('import-depth')) {
      const text = textOf(d.source);
      expect(text).toContain(`max: ${max as number}`);
      expect(text).toContain('../'.repeat(max as number));
      expect(text).toContain('../'.repeat((max as number) + 1));
      expect(text.join('\n')).toContain(`${(max as number) + 1} hops: reported`);
    }
  });

  test('component folder lists exactly the default sibling set', () => {
    const { requiredSiblings } = defaults('component-folder-structure');
    for (const d of both('component-folder')) {
      const siblings = textOf(d.source).filter((t) => /^TaskCard\..+/.test(t) && t !== 'TaskCard.tsx');
      const expected = (requiredSiblings as string[]).filter((s) => s !== 'index.ts').map((s) => `TaskCard${s}`);
      expect(siblings.sort()).toEqual(expected.sort());
      expect(textOf(d.source)).toContain('requireOwnFolder');
      expect(Object.keys(details.get('architecture/component-folder-structure')!.optionsSchema?.properties ?? {})).toContain('requireOwnFolder');
    }
  });

  test('layered bans uses the option keys the schema declares', () => {
    const keys = Object.keys(details.get('architecture/no-restricted-imports-layered')!.optionsSchema?.properties ?? {});
    expect(keys).toEqual(expect.arrayContaining(['bans', 'layers']));
    for (const d of both('layered-bans')) {
      const text = textOf(d.source);
      for (const field of ['files', 'ignores', 'bans']) expect(text).toContain(field);
    }
  });
});
