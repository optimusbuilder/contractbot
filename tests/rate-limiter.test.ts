import { describe, it, expect } from "vitest";
import { RateLimiter } from "../src/providers/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests under the limit", async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 10 });
    const waited = await limiter.waitForCapacity();
    expect(waited).toBe(0);
  });

  it("tracks requests and allows up to the limit", async () => {
    const limiter = new RateLimiter({ requestsPerMinute: 5 });

    for (let i = 0; i < 4; i++) {
      limiter.recordRequest(100);
    }

    const waited = await limiter.waitForCapacity();
    expect(waited).toBe(0);
  });

  it("records requests with token counts", () => {
    const limiter = new RateLimiter({ requestsPerMinute: 100 });
    limiter.recordRequest(500);
    limiter.recordRequest(300);
    // Should not throw
  });

  it("handles zero-token requests", async () => {
    const limiter = new RateLimiter({ tokensPerMinute: 1000 });
    const waited = await limiter.waitForCapacity(0);
    expect(waited).toBe(0);
  });
});

describe("RateLimiter — integration", () => {
  it("does not block when well under limits", async () => {
    const limiter = new RateLimiter({
      requestsPerMinute: 60,
      tokensPerMinute: 1_000_000,
    });

    const start = Date.now();
    for (let i = 0; i < 5; i++) {
      await limiter.waitForCapacity(100);
      limiter.recordRequest(100);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
  });
});
