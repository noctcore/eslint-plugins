import { describe, expect, test } from 'bun:test';

import { PRISMA_READ_METHODS, PRISMA_WRITE_METHODS } from '@noctcore/eslint-plugin-prisma';

import { createPrismaMethodSurfaceRule, parseDelegateSurfaces, type PrismaMethodSurfaceOptions } from '../../src/prisma';
import { createFakeCtx } from '../test-utils/createFakeCtx';
import { runLintMetaOnRealTree } from '../test-utils/runLintMetaOnRealTree';

const SURFACE = [...PRISMA_WRITE_METHODS, ...PRISMA_READ_METHODS].sort();

/**
 * A delegate in the shape the `prisma-client` generator emits per model: a
 * generic default holding `{}` on the opening line, a symbol brand, JSDoc with
 * braces and example calls, a multi-line member, and a `fields` property.
 */
function modelFile(model: string, methods: readonly string[] = SURFACE, indent = ''): string {
  const members = methods
    .map((method, i) =>
      i === 0
        ? `${indent}  /**\n${indent}   * Example: ${method}<T>({ where: { id: 1 } })\n${indent}   *   notAMethod<T>(x)\n${indent}   */\n${indent}  ${method}<\n${indent}    T extends ${model}Args,\n${indent}  >(args: T): Promise<{ [k: string]: unknown }>`
        : `${indent}  ${method}<T extends ${model}${method}Args>(args?: T): Promise<unknown> // ${method}<X>`,
    )
    .join('\n');
  return [
    `${indent}export interface ${model}Delegate<ExtArgs extends runtime.DefaultArgs = runtime.DefaultArgs, GlobalOmitOptions = {}> {`,
    `${indent}  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['${model}'], meta: { name: '${model}' } }`,
    members,
    `${indent}  readonly fields: ${model}FieldRefs;`,
    `${indent}}`,
    '',
    `${indent}export interface Prisma__${model}Client<T> {`,
    `${indent}  then<R>(onfulfilled?: (value: T) => R): Promise<R>`,
    `${indent}}`,
    '',
  ].join('\n');
}

const CLIENT = 'generated/prisma/models';
const OPTIONS: PrismaMethodSurfaceOptions = { clientGlobs: [`${CLIENT}/*.ts`] };

function run(files: Record<string, string>, options: PrismaMethodSurfaceOptions = OPTIONS) {
  return createPrismaMethodSurfaceRule(options).run?.(createFakeCtx({ files })) ?? [];
}

describe('parseDelegateSurfaces', () => {
  test('reads the generic methods of every delegate, and nothing else', () => {
    const surfaces = parseDelegateSurfaces(modelFile('Invoice') + modelFile('Project'), 'x.ts');
    expect(surfaces.map((s) => s.model)).toEqual(['Invoice', 'Project']);
    for (const surface of surfaces) expect(surface.methods).toEqual(SURFACE);
  });

  test('handles delegates declared inside a namespace (indented)', () => {
    const source = `export namespace Prisma {\n${modelFile('User', SURFACE, '  ')}}\n`;
    expect(parseDelegateSurfaces(source).map((s) => [s.model, s.methods.length])).toEqual([
      ['User', SURFACE.length],
    ]);
  });
});

describe('prisma-method-surface', () => {
  test('passes when the configured reads and writes are exactly the generated surface', () => {
    expect(
      run({ [`${CLIENT}/Invoice.ts`]: modelFile('Invoice'), [`${CLIENT}/Project.ts`]: modelFile('Project') }),
    ).toEqual([]);
  });

  test('also reads the classic single-file client', () => {
    const files = { 'node_modules/.prisma/client/index.d.ts': modelFile('Invoice') + modelFile('Project') };
    expect(run(files, {})).toEqual([]);
  });

  test('a method a Prisma upgrade adds is reported as unguarded', () => {
    const upgraded = [...SURFACE, 'upsertManyAndReturn'];
    const violations = run({
      [`${CLIENT}/Invoice.ts`]: modelFile('Invoice', upgraded),
      [`${CLIENT}/Project.ts`]: modelFile('Project', upgraded),
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.file).toBe(`${CLIENT}/Invoice.ts`);
    expect(violations[0]?.message).toMatch(/exposes "upsertManyAndReturn", which is neither a configured read nor a configured write/u);
  });

  test('a configured method the client no longer has is reported', () => {
    const violations = run({ [`${CLIENT}/Invoice.ts`]: modelFile('Invoice', SURFACE.filter((m) => m !== 'upsert')) });
    expect(violations.map((v) => v.message)).toEqual([
      expect.stringMatching(/^"upsert" is configured but the generated client no longer exposes it/u),
    ]);
  });

  test('a delegate whose surface differs from the others is reported', () => {
    const violations = run({
      [`${CLIENT}/Invoice.ts`]: modelFile('Invoice'),
      [`${CLIENT}/Project.ts`]: modelFile('Project', [...SURFACE, 'extra']),
    });
    expect(violations.map((v) => v.file)).toEqual([`${CLIENT}/Project.ts`]);
    expect(violations[0]?.message).toMatch(/ProjectDelegate exposes .* which differs from InvoiceDelegate/u);
  });

  test('writeMethods and readMethods are options, and must not overlap', () => {
    const files = { [`${CLIENT}/Invoice.ts`]: modelFile('Invoice', ['create', 'findMany']) };
    expect(run(files, { ...OPTIONS, writeMethods: ['create'], readMethods: ['findMany'] })).toEqual([]);

    const overlap = run(files, { ...OPTIONS, writeMethods: ['create', 'findMany'], readMethods: ['findMany'] });
    expect(overlap.map((v) => v.message)).toEqual([
      expect.stringMatching(/^"findMany" is configured as both a read and a write/u),
    ]);
  });

  test('fails closed when no generated client is found', () => {
    const violations = run({ 'src/app.ts': 'export {};\n' });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.message).toMatch(/No generated Prisma client found/u);
  });

  test('the defaults police the @noctcore/eslint-plugin-prisma method sets', () => {
    const rule = createPrismaMethodSurfaceRule();
    expect(rule.id).toBe('prisma-method-surface');
    expect(rule.ciCritical).toBe(true);
    expect(typeof rule.run).toBe('function');
  });
});

describe('prisma-method-surface through the real harness', () => {
  // `node_modules/.prisma` is a dot-directory under node_modules: the path the
  // real glob has to reach for the classic client.
  const upgraded = [...SURFACE, 'upsertManyAndReturn'];
  const files = { 'node_modules/.prisma/client/index.d.ts': modelFile('Invoice', upgraded) };

  test('under Bun, from source (reaches node_modules/.prisma)', () => {
    const run = runLintMetaOnRealTree(files, 'createPrismaMethodSurfaceRule');
    expect(run.violations).toEqual([
      expect.stringMatching(/^prisma-method-surface \(node_modules\/\.prisma\/client\/index\.d\.ts\): The generated client exposes "upsertManyAndReturn"/u),
    ]);
    expect(run.code).toBe(1);
  }, 60_000);

  test('under Node, from the built package', () => {
    const run = runLintMetaOnRealTree(files, 'createPrismaMethodSurfaceRule', {}, { runtime: 'node-eslint9' });
    expect(run.violations).toHaveLength(1);
    expect(run.code).toBe(1);
  }, 60_000);

  test('a clean per-model client passes', () => {
    const run = runLintMetaOnRealTree({ [`${CLIENT}/Invoice.ts`]: modelFile('Invoice') }, 'createPrismaMethodSurfaceRule');
    expect(run.violations).toEqual([]);
    expect(run.code).toBe(0);
  }, 60_000);
});
