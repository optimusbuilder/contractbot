import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkSdkVersion } from "../src/watcher/sdk-version.js";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const CACHE = join(process.cwd(), ".contractbot/cache/sdk");

beforeEach(async () => {
  if (existsSync(CACHE)) await rm(CACHE, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (existsSync(CACHE)) await rm(CACHE, { recursive: true });
});

describe("checkSdkVersion", () => {
  it("baselines on first run with no events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      })),
    );

    const events = await checkSdkVersion("test-api", {
      ecosystem: "npm",
      package: "left-pad",
    });
    expect(events).toHaveLength(0);
  });

  it("emits event when version changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "1.0.0" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: "2.0.0" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    await checkSdkVersion("bump-api", { ecosystem: "npm", package: "pkg" });
    const events = await checkSdkVersion("bump-api", {
      ecosystem: "npm",
      package: "pkg",
    });

    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe("breaking");
    expect(events[0].description).toContain("1.0.0 → 2.0.0");
  });
});
