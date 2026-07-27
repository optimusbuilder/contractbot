import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    // Several command tests intentionally exercise the shared on-disk cache.
    fileParallelism: false,
  },
});
