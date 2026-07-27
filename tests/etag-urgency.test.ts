import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSpec } from "../src/differ/fetcher.js";
import { cacheSpec, getCachedMeta } from "../src/differ/cache.js";
import { meetsMinUrgency, pollIntervalMinutes } from "../src/config/schema.js";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const CACHE = join(process.cwd(), ".apihealer/cache");

beforeEach(async () => {
  if (existsSync(CACHE)) await rm(CACHE, { recursive: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (existsSync(CACHE)) await rm(CACHE, { recursive: true });
});

describe("meetsMinUrgency", () => {
  it("filters by urgency rank", () => {
    expect(
      meetsMinUrgency({ name: "a", scan_paths: [], urgency: "low" }, "critical"),
    ).toBe(false);
    expect(
      meetsMinUrgency({ name: "a", scan_paths: [], urgency: "critical" }, "normal"),
    ).toBe(true);
    expect(
      meetsMinUrgency({ name: "a", scan_paths: [] }, "low"),
    ).toBe(true); // defaults to normal
  });
});

describe("pollIntervalMinutes", () => {
  it("returns 15 for critical/normal", () => {
    expect(pollIntervalMinutes("critical")).toBe(15);
    expect(pollIntervalMinutes("normal")).toBe(15);
    expect(pollIntervalMinutes("low")).toBe(60);
  });
});

describe("fetchSpec ETag", () => {
  it("sends If-None-Match and handles 304", async () => {
    await cacheSpec(
      "etag-api",
      { openapi: "3.0.0", info: { title: "t", version: "1" }, paths: {} },
      { etag: '"abc123"', url: "https://example.com/openapi.json" },
    );

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers["If-None-Match"]).toBe('"abc123"');
      return {
        status: 304,
        ok: false,
        headers: { get: () => null },
        text: async () => "",
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSpec("https://example.com/openapi.json", {
      apiName: "etag-api",
    });

    expect(result.notModified).toBe(true);
    expect(result.spec.info?.title).toBe("t");
  });

  it("stores etag on 200 responses via cacheSpec", async () => {
    const fetchMock = vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: {
        get: (name: string) =>
          name === "etag"
            ? '"new-etag"'
            : name === "last-modified"
              ? "Mon, 01 Jan 2024 00:00:00 GMT"
              : name === "content-type"
                ? "application/json"
                : null,
      },
      text: async () =>
        JSON.stringify({
          openapi: "3.0.0",
          info: { title: "fresh", version: "2" },
          paths: {},
        }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchSpec("https://example.com/openapi.json", {
      apiName: "fresh-api",
    });
    expect(result.notModified).toBe(false);
    expect(result.etag).toBe('"new-etag"');

    await cacheSpec("fresh-api", result.spec, {
      etag: result.etag,
      lastModified: result.lastModified,
      url: "https://example.com/openapi.json",
    });

    const meta = await getCachedMeta("fresh-api");
    expect(meta?.etag).toBe('"new-etag"');
  });
});
