// Fixture: a helper module that never restores timers.
export function makeSubject(): { tick: () => void } {
  return { tick: () => undefined };
}
