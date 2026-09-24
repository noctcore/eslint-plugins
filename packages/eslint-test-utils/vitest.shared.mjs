/**
 * Shared Vitest config for every `@noctcore` package's tests.
 *
 * `isolate: false` lets the test files a worker runs share one module graph.
 * Almost all of a rule test file's cost is importing `typescript`, `eslint`
 * and the typescript-eslint parser; with isolation each file paid it again,
 * which made import 60-78% of CI test time. The suites are safe to share a
 * worker: nothing uses `vi.mock`, fixtures on disk are read-only, and tests
 * that write do so under their own `mkdtemp` directory. Run with
 * `--sequence.shuffle` if a new test ever starts to depend on file order.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    isolate: false,
  },
});
