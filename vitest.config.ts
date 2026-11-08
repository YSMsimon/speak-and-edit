import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  // Tests run as the full edition (lib/edition.ts); edition.test.ts checks the public one through its pure functions.
  define: { __SCRIBE_FULL__: 'true' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
