---
'@noctcore/eslint-plugin-async-safety': minor
---

`no-shared-mutable-module-state` (opt-in, needs `include`) now checks methods of exported classes, which is a new report, so this is a minor bump.

- Every method of an exported class is an entry point, async or not: in a DI framework (a NestJS `@Injectable()`) one instance serves every request. `let cache = {}; export class S { set(k, v) { cache[k] = v; } }` is reported. The constructor is skipped (it runs at wiring time), and `this.x` instance state is not a module binding and is not checked. Class expressions, arrow-function properties and private methods count.
- A function or class exported by a later `export { name }` or `export default name` is checked like an inline export.
- Internal: the rules walk the parser's visitor keys through `@noctcore/eslint-utils` instead of their own `Object.keys` walker, and `no-leaky-race-timeout` uses the shared `enclosingFunction`. No report changes from that.
