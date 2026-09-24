import shared from '@noctcore/eslint-test-utils/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(shared, defineConfig({
  test: {
    /*
     * `translation-key-exists` is the only rule here tested with type
     * information, and `@typescript-eslint/rule-tester` has to build a real
     * TypeScript program for those cases. That costs milliseconds on a
     * developer machine and seconds on a 2-vCPU CI runner: the whole suite
     * runs in ~1.6s locally and took ~26s on CI, where one typed case blew
     * vitest's 5s default and reded the build.
     *
     * The timeout is raised rather than the test weakened, because the
     * slowness is inherent to typed linting and not a symptom. It is still
     * bounded, so a genuinely hung case fails instead of hanging the job.
     */
    testTimeout: 30_000,
  },
}));
