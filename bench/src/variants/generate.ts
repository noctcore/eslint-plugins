/**
 * Metamorphic variants: semantics-preserving rewrites of every corpus case,
 * generated at bench time and never committed. A rule's verdict should not
 * change when a case is rewritten in a way that keeps what the code does; a
 * vulnerable variant the rule misses, or a safe variant it reports, is a
 * shape the rule depends on.
 *
 * Every transform plans text edits against the case's AST (the same
 * `@typescript-eslint/parser` the scorer lints with) and is skipped when it
 * does not apply; it never fakes a rewrite. Each variant must parse and keep
 * exactly its case's labels (`// expect:` or `// ok`), or generation fails.
 */
import { hasOkMarker, maskBenchComments, parseExpects, type Category, type CorpusCase } from '../corpus';
import { Names, parseSource } from './ast';
import { applyEdits } from './edits';
import { arrowFunctions, functionArrows, tsAnnotations } from './functions';
import {
  callback,
  promiseAwait,
  promiseThen,
  tsAsCast,
  tsNonNull,
  viaArray,
  viaDestructuring,
  viaHelper,
  viaObject,
  viaSpread,
  viaVariable,
} from './flow';
import { cjsToEsm, esmToCjs, importAlias, importNamespace, nodePrefix } from './modules';
import { renameLocals, renameParams } from './names';
import { sinkLines } from './sinks';
import { stringConcat, stringConcatMethod, stringJoin, stringTemplate } from './strings';
import type { Transform } from './transform';


/** Every transform, in the order the report lists them. */
export const TRANSFORMS: readonly Transform[] = [
  renameLocals,
  renameParams,
  importAlias,
  importNamespace,
  esmToCjs,
  cjsToEsm,
  nodePrefix,
  viaVariable,
  viaHelper,
  viaObject,
  viaDestructuring,
  viaSpread,
  viaArray,
  stringConcat,
  stringTemplate,
  stringConcatMethod,
  stringJoin,
  promiseAwait,
  promiseThen,
  callback,
  arrowFunctions,
  functionArrows,
  tsAnnotations,
  tsAsCast,
  tsNonNull,
];

/** The variants every case should get; the report lists the cases whose shape allows fewer. */
export const MIN_VARIANTS_PER_CASE = 10;

/** Marks a variant's file: `security/ssrf/x.vuln.js.case~via-helper`. */
export const VARIANT_MARK = '~';

export interface Variant extends CorpusCase {
  readonly transform: string;
  /** The corpus case this variant rewrites. */
  readonly baseFile: string;
}

export class VariantError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`The variant generator produced ${problems.length} broken variant(s):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'VariantError';
  }
}

function sameLabels(a: string, b: string): boolean {
  const rules = (s: string): string => parseExpects(s).map((l) => l.rule).sort().join(',');
  return rules(a) === rules(b) && hasOkMarker(a) === hasOkMarker(b) && a.split('\n', 1)[0] === b.split('\n', 1)[0];
}

export interface CaseVariants {
  readonly variants: readonly Variant[];
  /** Transforms that planned a rewrite whose edits overlapped, so it was dropped. */
  readonly overlapping: readonly string[];
  readonly problems: readonly string[];
}

/** Every variant of one case; `vulnTwins` are the vulnerable cases of its pair. */
export function generateVariants(testCase: CorpusCase, vulnTwins: readonly CorpusCase[], transforms = TRANSFORMS): CaseVariants {
  const variants: Variant[] = [];
  const overlapping: string[] = [];
  const problems: string[] = [];
  const parsed = parseSource(testCase.source, testCase.lintPath);
  const lines = sinkLines(testCase, vulnTwins, parsed);
  for (const transform of transforms) {
    const file = `${testCase.file}${VARIANT_MARK}${transform.name}`;
    let source: string | null;
    try {
      const edits = transform.plan({ p: parsed, sinkLines: lines, names: new Names(testCase.source) });
      source = edits.length === 0 ? testCase.source : applyEdits(testCase.source, edits);
    } catch (error) {
      problems.push(`${file}: the transform threw: ${(error as Error).message}`);
      continue;
    }
    if (source === null) {
      overlapping.push(transform.name);
      continue;
    }
    if (source === testCase.source) continue;
    try {
      parseSource(source, testCase.lintPath);
    } catch (error) {
      problems.push(`${file}: does not parse: ${(error as Error).message}`);
      continue;
    }
    if (!sameLabels(source, testCase.source)) {
      problems.push(`${file}: the rewrite changed the header, the labels or the "// ok" marker`);
      continue;
    }
    variants.push({
      ...testCase,
      file,
      source,
      lintSource: maskBenchComments(source),
      expects: parseExpects(source),
      transform: transform.name,
      baseFile: testCase.file,
    });
  }
  return { variants, overlapping, problems };
}

export interface CorpusVariants {
  readonly variants: readonly Variant[];
  /** Variants per corpus case, by case file. */
  readonly counts: ReadonlyMap<string, number>;
}

/** Every variant of every case of the categories; throws a {@link VariantError} listing every broken one. */
export function generateCorpusVariants(categories: readonly Category[]): CorpusVariants {
  const variants: Variant[] = [];
  const counts = new Map<string, number>();
  const problems: string[] = [];
  for (const category of categories) {
    for (const testCase of category.cases) {
      const twins = category.cases.filter((c) => c.kind === 'vuln' && c.meta.pair === testCase.meta.pair);
      const result = generateVariants(testCase, twins);
      variants.push(...result.variants);
      problems.push(...result.problems);
      counts.set(testCase.file, result.variants.length);
    }
  }
  if (problems.length > 0) throw new VariantError(problems);
  return { variants, counts };
}

/** `security/ssrf/x.vuln.js.case~via-helper` into its case file and transform, or null. */
export function splitVariantFile(file: string): { baseFile: string; transform: string } | null {
  const at = file.lastIndexOf(VARIANT_MARK);
  return at === -1 ? null : { baseFile: file.slice(0, at), transform: file.slice(at + 1) };
}
