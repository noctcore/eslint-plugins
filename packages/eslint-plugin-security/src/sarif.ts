import type { ESLint } from 'eslint';

import { buildSarifLog } from './sarif-log';

/*
 * The ESLint formatter: SARIF 2.1.0 with each rule's CWE and OWASP tags and
 * its `security-severity`, written without any dependency (see `./sarif-log`).
 *
 * ESLint resolves a scoped `--format` name to `@scope/eslint-formatter-*`, so
 * name this file by path; the ESM and CJS builds both export the formatter
 * function itself:
 *
 *   eslint -f ./node_modules/@noctcore/eslint-plugin-security/dist/sarif.js -o out.sarif .
 *
 * Locations are relative to the working directory, under the `SRCROOT` base
 * id. Set `NOCTCORE_SARIF_ABSOLUTE_URIS=1` to write absolute file URIs.
 *
 * This module has only a default export, so the CJS build is
 * `module.exports = formatSarif`.
 */
export default function formatSarif(
  results: ESLint.LintResult[],
  data?: ESLint.LintResultData,
): string {
  // The formatter runs inside the ESLint CLI with no config of its own, so its one switch is an
  // environment variable read here.
  // eslint-disable-next-line noctcore-contracts/no-direct-process-env -- a formatter's only input besides results
  const flag = process.env.NOCTCORE_SARIF_ABSOLUTE_URIS;
  const absoluteUris =
    flag !== undefined && flag !== '' && flag !== '0' && flag.toLowerCase() !== 'false';
  return JSON.stringify(buildSarifLog(results ?? [], data, { absoluteUris }), null, 2);
}
