import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // One app, one database: run files and tests one at a time so timing-based
    // checks (cancel, concurrency, restart) are not disturbed by other tests.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 60_000,
    retry: 0,
  },
});
