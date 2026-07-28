import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { checkChangelogs } from "../src/watcher/changelog.js";

const CACHE = ".contractbot/cache/changelogs/changelog-test-github_releases.json";
const SOURCE = { type: "github_releases" as const, url: "https://github.com/example/changelog-test/releases", repo: "example/changelog-test" };

afterEach(async () => {
  vi.restoreAllMocks();
  if (existsSync(CACHE)) await rm(CACHE);
});

describe("checkChangelogs", () => {
  it("baselines existing entries and reports only newly published entries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: 1, name: "Initial release", html_url: "https://example.com/1", published_at: "2000-01-01T00:00:00.000Z", body: "Initial" }],
    })));
    expect(await checkChangelogs("changelog-test", [SOURCE])).toEqual([]);

    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: 2, name: "Breaking change", html_url: "https://example.com/2", published_at: "2099-01-01T00:00:00.000Z", body: "Migration required" }],
    })));
    const events = await checkChangelogs("changelog-test", [SOURCE]);

    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("Breaking change");
  });
});
