import { describe, it, expect, vi, afterEach } from "vitest";
import { TrackedProvider } from "../src/providers/tracked-provider.js";
import { LlmProvider } from "../src/providers/types.js";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TEST_CACHE_DIR = join(process.cwd(), ".test-tracked-provider-tmp");

function makeMockProvider(response: string = "mock response"): LlmProvider {
  return {
    generate: vi.fn().mockResolvedValue(response),
  };
}

async function cleanup() {
  if (existsSync(TEST_CACHE_DIR)) {
    await rm(TEST_CACHE_DIR, { recursive: true });
  }
}

describe("TrackedProvider", () => {
  afterEach(cleanup);

  it("delegates to inner provider", async () => {
    const inner = makeMockProvider("ai response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: false },
    });

    const result = await tracked.generate("test prompt", "system");
    expect(result).toBe("ai response");
    expect(inner.generate).toHaveBeenCalledWith("test prompt", "system");
  });

  it("returns cached response without calling inner provider", async () => {
    const inner = makeMockProvider("first response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: true, cacheDir: TEST_CACHE_DIR },
    });

    await tracked.generate("prompt", "system");
    expect(inner.generate).toHaveBeenCalledTimes(1);

    const result = await tracked.generate("prompt", "system");
    expect(result).toBe("first response");
    expect(inner.generate).toHaveBeenCalledTimes(1); // Not called again
  });

  it("tracks usage for non-cached calls", async () => {
    const inner = makeMockProvider("response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: false },
    });

    await tracked.generate("prompt", "system");
    const summary = tracked.usage.getSummary();

    expect(summary.totalRequests).toBe(1);
    expect(summary.cachedRequests).toBe(0);
  });

  it("tracks usage for cached calls", async () => {
    const inner = makeMockProvider("response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: true, cacheDir: TEST_CACHE_DIR },
    });

    await tracked.generate("prompt", "system");
    await tracked.generate("prompt", "system"); // cache hit

    const summary = tracked.usage.getSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.cachedRequests).toBe(1);
  });

  it("throws when budget is exceeded", async () => {
    const inner = makeMockProvider("x".repeat(10_000));
    const tracked = new TrackedProvider(inner, "gpt-4o", {
      cache: { enabled: false },
      budgetUsd: 0.0001,
    });

    await tracked.generate("x".repeat(100_000), "system");

    await expect(
      tracked.generate("x".repeat(100_000), "system"),
    ).rejects.toThrow("Budget limit");
  });

  it("throws when max requests exceeded", async () => {
    const inner = makeMockProvider("response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: false },
      maxRequests: 1,
    });

    await tracked.generate("prompt1", "system");

    await expect(
      tracked.generate("prompt2", "system"),
    ).rejects.toThrow("Request limit");
  });

  it("does not count cached hits toward request limits", async () => {
    const inner = makeMockProvider("response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: true, cacheDir: TEST_CACHE_DIR },
      maxRequests: 1,
    });

    await tracked.generate("prompt", "system"); // 1 real call
    const result = await tracked.generate("prompt", "system"); // cache hit — should not count

    expect(result).toBe("response");
    expect(inner.generate).toHaveBeenCalledTimes(1);
  });

  it("exposes cache stats", async () => {
    const inner = makeMockProvider("response");
    const tracked = new TrackedProvider(inner, "gpt-4o-mini", {
      cache: { enabled: true, cacheDir: TEST_CACHE_DIR },
    });

    await tracked.generate("prompt", "system");
    await tracked.generate("prompt", "system");
    await tracked.generate("different", "system");

    const stats = tracked.cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
  });
});
