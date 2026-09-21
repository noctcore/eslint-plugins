// Fixture: a shared suite that owns the fake-timer restore for its callers.
export function runClockSuite(subject: { tick: () => void }): void {
  describe('clock contract', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('ticks', () => {
      subject.tick();
    });
  });
}
