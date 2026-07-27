import { describe, it, expect } from "vitest";
import { UsageTracker } from "../src/providers/usage.js";

describe("UsageTracker", () => {
  describe("estimateTokens", () => {
    it("estimates ~1 token per 4 characters", () => {
      expect(UsageTracker.estimateTokens("abcd")).toBe(1);
      expect(UsageTracker.estimateTokens("12345678")).toBe(2);
      expect(UsageTracker.estimateTokens("")).toBe(0);
    });

    it("rounds up partial tokens", () => {
      expect(UsageTracker.estimateTokens("abc")).toBe(1); // 3/4 = 0.75 → 1
      expect(UsageTracker.estimateTokens("abcde")).toBe(2); // 5/4 = 1.25 → 2
    });
  });

  describe("estimateCost", () => {
    it("estimates cost for known models", () => {
      const cost = UsageTracker.estimateCost("gpt-4o-mini", 1_000_000, 1_000_000);
      expect(cost).toBeCloseTo(0.15 + 0.6, 2); // $0.15 input + $0.60 output
    });

    it("returns 0 for unknown/local models", () => {
      expect(UsageTracker.estimateCost("llama3.1", 1000, 1000)).toBe(0);
      expect(UsageTracker.estimateCost("my-custom-model", 1000, 1000)).toBe(0);
    });

    it("matches partial model names", () => {
      const cost = UsageTracker.estimateCost("gpt-4o-mini-2024-07-18", 1_000_000, 0);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe("record and summary", () => {
    it("records a non-cached request", () => {
      const tracker = new UsageTracker();
      const record = tracker.record("gpt-4o-mini", "Hello, fix this code", "Here is the fix", false);

      expect(record.cached).toBe(false);
      expect(record.inputTokens).toBeGreaterThan(0);
      expect(record.outputTokens).toBeGreaterThan(0);
      expect(record.estimatedCostUsd).toBeGreaterThan(0);
    });

    it("records zero cost for cached requests", () => {
      const tracker = new UsageTracker();
      const record = tracker.record("gpt-4o-mini", "prompt", "response", true);

      expect(record.cached).toBe(true);
      expect(record.estimatedCostUsd).toBe(0);
    });

    it("accumulates totals in summary", () => {
      const tracker = new UsageTracker();
      tracker.record("gpt-4o-mini", "prompt1", "response1", false);
      tracker.record("gpt-4o-mini", "prompt2", "response2", false);
      tracker.record("gpt-4o-mini", "prompt3", "response3", true);

      const summary = tracker.getSummary();
      expect(summary.totalRequests).toBe(3);
      expect(summary.cachedRequests).toBe(1);
      expect(summary.totalInputTokens).toBeGreaterThan(0);
      expect(summary.totalOutputTokens).toBeGreaterThan(0);
    });

    it("groups by model in summary", () => {
      const tracker = new UsageTracker();
      tracker.record("gpt-4o-mini", "p", "r", false);
      tracker.record("claude-sonnet-4-20250514", "p", "r", false);

      const summary = tracker.getSummary();
      expect(summary.byModel.size).toBe(2);
      expect(summary.byModel.has("gpt-4o-mini")).toBe(true);
      expect(summary.byModel.has("claude-sonnet-4-20250514")).toBe(true);
    });
  });

  describe("budget enforcement", () => {
    it("allows requests within budget", () => {
      const tracker = new UsageTracker({ budgetUsd: 1.0 });
      tracker.record("gpt-4o-mini", "x".repeat(100), "y".repeat(100), false);

      expect(tracker.checkBudget().allowed).toBe(true);
    });

    it("blocks requests when budget exceeded", () => {
      const tracker = new UsageTracker({ budgetUsd: 0.0001 });
      tracker.record("gpt-4o", "x".repeat(100_000), "y".repeat(100_000), false);

      const check = tracker.checkBudget();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Budget limit");
    });

    it("blocks requests when max request count exceeded", () => {
      const tracker = new UsageTracker({ maxRequests: 2 });
      tracker.record("gpt-4o", "p1", "r1", false);
      tracker.record("gpt-4o", "p2", "r2", false);

      const check = tracker.checkBudget();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("Request limit");
    });

    it("does not count cached requests toward max", () => {
      const tracker = new UsageTracker({ maxRequests: 2 });
      tracker.record("gpt-4o", "p1", "r1", false);
      tracker.record("gpt-4o", "p2", "r2", true); // cached
      tracker.record("gpt-4o", "p3", "r3", true); // cached

      expect(tracker.checkBudget().allowed).toBe(true);
    });

    it("allows everything when no limits set", () => {
      const tracker = new UsageTracker();
      for (let i = 0; i < 100; i++) {
        tracker.record("gpt-4o", "p", "r", false);
      }
      expect(tracker.checkBudget().allowed).toBe(true);
    });
  });

  describe("formatSummary", () => {
    it("produces readable output", () => {
      const tracker = new UsageTracker({ budgetUsd: 5.0 });
      tracker.record("gpt-4o-mini", "prompt text here", "response text", false);
      tracker.record("gpt-4o-mini", "another prompt", "another response", true);

      const output = tracker.formatSummary();
      expect(output).toContain("AI Usage: 2 request(s) (1 cached)");
      expect(output).toContain("Tokens:");
      expect(output).toContain("Budget:");
    });

    it("shows $0 for free/local models", () => {
      const tracker = new UsageTracker();
      tracker.record("llama3.1", "prompt", "response", false);

      const output = tracker.formatSummary();
      expect(output).toContain("$0");
    });
  });
});
