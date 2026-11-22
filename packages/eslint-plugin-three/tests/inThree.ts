/**
 * The import-gated rules run only in files that import three.js or R3F. Most
 * cases are about the shape inside such a file, so this adds the import to
 * every case that has none; the gate itself is tested with cases kept outside.
 */
const IMPORT = "import * as THREE from 'three';\n";

type Case = string | { readonly code: string };

function withImport<T extends Case>(test: T): T {
  const code = typeof test === 'string' ? test : test.code;
  if (/from '(?:three|@react-three\/)/u.test(code)) return test;
  return (typeof test === 'string' ? IMPORT + test : { ...test, code: IMPORT + test.code }) as T;
}

export function inThree<V extends Case, I extends { readonly code: string }>(cases: {
  valid: readonly V[];
  invalid: readonly I[];
}): { valid: V[]; invalid: I[] } {
  return { valid: cases.valid.map(withImport), invalid: cases.invalid.map(withImport) };
}
