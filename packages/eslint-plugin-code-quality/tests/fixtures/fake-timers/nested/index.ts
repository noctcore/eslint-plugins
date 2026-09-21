// Fixture: a directory-index suite that restores timers with vitest.
export function runNestedSuite(): void {
  afterEach(() => vi.useRealTimers());
}
