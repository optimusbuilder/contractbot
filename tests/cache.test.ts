import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AiCache } from "../src/providers/cache.js";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TEST_CACHE_DIR = join(process.cwd(), ".test-ai-cache-tmp");

function makeCache(options: { ttlMs?: number; maxEntries?: number } = {}) {
  return new AiCache({
    enabled: true,
    cacheDir: TEST_CACHE_DIR,
    ttlMs: options.ttlMs ?? 60_000,
    maxEntries: options.maxEntries ?? 100,
  });
}

afterEach(async () => {
  if (existsSync(TEST_CACHE_DIR)) {
    await rm(TEST_CACHE_DIR, { recursive: true });
  }
});

describe("AiCache", () => {
  it("returns null on cache miss", async () => {
    const cache = makeCache();
    const result = await cache.get("some prompt", "system", "gpt-4o");
    expect(result).toBeNull();
  });

  it("returns cached response on hit", async () => {
    const cache = makeCache();
    await cache.set("prompt1", "system1", "gpt-4o", "response1");

    const result = await cache.get("prompt1", "system1", "gpt-4o");
    expect(result).toBe("response1");
  });

  it("differentiates by model", async () => {
    const cache = makeCache();
    await cache.set("prompt", "system", "gpt-4o", "openai response");
    await cache.set("prompt", "system", "claude-sonnet-4-20250514", "anthropic response");

    expect(await cache.get("prompt", "system", "gpt-4o")).toBe("openai response");
    expect(await cache.get("prompt", "system", "claude-sonnet-4-20250514")).toBe("anthropic response");
  });

  it("differentiates by system prompt", async () => {
    const cache = makeCache();
    await cache.set("prompt", "system-a", "gpt-4o", "response-a");
    await cache.set("prompt", "system-b", "gpt-4o", "response-b");

    expect(await cache.get("prompt", "system-a", "gpt-4o")).toBe("response-a");
    expect(await cache.get("prompt", "system-b", "gpt-4o")).toBe("response-b");
  });

  it("returns null for expired entries", async () => {
    const cache = makeCache({ ttlMs: 1 });
    await cache.set("prompt", "system", "gpt-4o", "response");

    await new Promise((r) => setTimeout(r, 10));
    const result = await cache.get("prompt", "system", "gpt-4o");
    expect(result).toBeNull();
  });

  it("does nothing when disabled", async () => {
    const cache = new AiCache({ enabled: false, cacheDir: TEST_CACHE_DIR });
    await cache.set("prompt", "system", "gpt-4o", "response");

    const result = await cache.get("prompt", "system", "gpt-4o");
    expect(result).toBeNull();
  });

  it("tracks hit/miss stats", async () => {
    const cache = makeCache();
    await cache.get("miss1", "s", "gpt-4o");
    await cache.set("hit1", "s", "gpt-4o", "r");
    await cache.get("hit1", "s", "gpt-4o");
    await cache.get("miss2", "s", "gpt-4o");

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBe("33.3%");
  });

  it("evicts oldest entries when max exceeded", async () => {
    const cache = makeCache({ maxEntries: 3 });

    for (let i = 0; i < 5; i++) {
      await cache.set(`prompt-${i}`, "system", "gpt-4o", `response-${i}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    // Most recent entries should survive
    expect(await cache.get("prompt-4", "system", "gpt-4o")).toBe("response-4");
    expect(await cache.get("prompt-3", "system", "gpt-4o")).toBe("response-3");
  });

  it("hashContent is deterministic", () => {
    const h1 = AiCache.hashContent("hello world");
    const h2 = AiCache.hashContent("hello world");
    const h3 = AiCache.hashContent("hello world!");
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
