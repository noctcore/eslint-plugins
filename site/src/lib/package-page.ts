/**
 * Data for the package page header: the "bad fit" line every package page
 * already states in prose, and the preset counts. Pure, tested in
 * scripts/config-builder.test.ts.
 */
import type { BuilderPackage } from './config-builder';

const BAD_FIT = '**It is a bad fit**';

/**
 * The text after `**It is a bad fit**` in a package page's body, up to the end
 * of its sentence: the first `.` outside a code span that is followed by
 * whitespace or the end of the line (`package.json` and `utils.x.invalidate()`
 * do not end it). Throws when the page has no such sentence, so a page that
 * loses it fails the build instead of rendering an empty line.
 */
export function badFitLine(body: string): string {
  const start = body.indexOf(BAD_FIT);
  if (start === -1) throw new Error(`no "${BAD_FIT}" sentence in the package page`);
  const rest = body.slice(start + BAD_FIT.length);
  let inCode = false;
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i];
    if (char === '`') inCode = !inCode;
    else if (char === '\n' && !inCode) return rest.slice(0, i).trim();
    else if (char === '.' && !inCode && (i + 1 === rest.length || /\s/.test(rest[i + 1]!))) return rest.slice(0, i).trim();
  }
  return rest.trim();
}

/**
 * Rules on in `recommended`, on only in `strict`, and left for you to turn on.
 * A deprecated rule is none of these: it is in no preset on purpose.
 */
export function presetCounts(pkg: BuilderPackage): {
  recommended: number;
  strictOnly: number;
  optIn: number;
} {
  let recommended = 0;
  let strictOnly = 0;
  let optIn = 0;
  for (const rule of pkg.rules) {
    if (rule.recommended === 'error') recommended++;
    else if (rule.strict === 'error') strictOnly++;
    else if (!rule.deprecated) optIn++;
  }
  return { recommended, strictOnly, optIn };
}
