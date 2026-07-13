/**
 * `@noctcore/lint-meta-rules` — a portable, versioned SOURCE CATALOG of
 * `lint-meta` rules: whole-repo / cross-file invariants that ESLint's per-file
 * AST model cannot reach (every `package.json` name matches a convention, every
 * imported workspace package is a declared dependency, file-size ratchets, and
 * so on). Each rule is a pure function of an {@link IMetaCtx} returning
 * {@link IViolation}s and implements the portable {@link IMetaRule} contract
 * published by `@noctcore/harness`.
 *
 * ## How this package is consumed
 *
 * This is a rule-source catalog, NOT a runtime dependency you `require()` from a
 * consumer's registry. Nightcore's harness `lint-meta` subcommand runs a bounded
 * eval that executes only one local `.nightcore/lint-meta/registry.js` and never
 * resolves arbitrary imports (a deliberate security boundary — that file runs
 * inside a foreign CI). So the intended integration point is the harness EXPORT
 * pipeline: it reads a rule's source here, inlines/transforms it, and emits flat
 * JavaScript directly into a consumer's `.nightcore/lint-meta/`. No consumer
 * registry ever imports `@noctcore/lint-meta-rules` at runtime. (The export
 * pipeline itself is separate, out-of-scope wiring.)
 *
 * ## Why factories
 *
 * `IMetaRule.run(ctx)` takes no config, so every rule that hardcoded a
 * nightcore-specific anchor (a `@nightcore` scope, an `apps/web/src` root, a
 * rank table) is exported as a FACTORY — `createXRule(options): IMetaRule` —
 * with the anchors lifted to typed options carrying sensible defaults. The
 * export pipeline (or any programmatic caller) constructs each rule with the
 * consumer's own options; the emitted rule is a plain pre-configured
 * {@link IMetaRule}.
 */
export * from './rules';
