import { describe, it, expect } from "vitest";
import {
  buildPathRegexes,
  matchesAnyPath,
  extractEndpoint,
  getSurrounding,
  dedup,
  trackUrlVariables,
  lineUsesTrackedVar,
  joinContinuationLines,
} from "../src/scanner/utils.js";

describe("buildPathRegexes", () => {
  it("converts path params to wildcard matchers", () => {
    const regexes = buildPathRegexes(["/v1/users/{userId}/posts/{postId}"]);
    expect(regexes[0].test("/v1/users/abc123/posts/456")).toBe(true);
    expect(regexes[0].test("/v1/users//posts/")).toBe(false);
  });

  it("handles paths without params", () => {
    const regexes = buildPathRegexes(["/v1/health"]);
    expect(regexes[0].test("/v1/health")).toBe(true);
    expect(regexes[0].test("/v1/healthz")).toBe(true); // partial match is expected
    expect(regexes[0].test("/v2/health")).toBe(false);
  });
});

describe("matchesAnyPath", () => {
  it("matches when any pattern hits", () => {
    const regexes = buildPathRegexes(["/v1/users", "/v1/orders"]);
    expect(matchesAnyPath('fetch("/v1/users")', regexes)).toBe(true);
    expect(matchesAnyPath('fetch("/v1/orders")', regexes)).toBe(true);
    expect(matchesAnyPath('fetch("/v1/products")', regexes)).toBe(false);
  });
});

describe("extractEndpoint", () => {
  it("returns first matching path segment", () => {
    const regexes = buildPathRegexes(["/v1/users"]);
    const result = extractEndpoint('const url = "https://api.example.com/v1/users?page=1"', regexes);
    expect(result).toContain("/v1/users");
  });

  it("returns undefined when no match", () => {
    const regexes = buildPathRegexes(["/v1/users"]);
    expect(extractEndpoint("no urls here", regexes)).toBeUndefined();
  });
});

describe("getSurrounding", () => {
  const lines = ["a", "b", "c", "d", "e", "f", "g"];

  it("returns surrounding lines within bounds", () => {
    const result = getSurrounding(lines, 3, 2);
    expect(result).toBe("b\nc\nd\ne\nf");
  });

  it("clamps to start of file", () => {
    const result = getSurrounding(lines, 0, 2);
    expect(result).toBe("a\nb\nc");
  });

  it("clamps to end of file", () => {
    const result = getSurrounding(lines, 6, 2);
    expect(result).toBe("e\nf\ng");
  });
});

describe("dedup", () => {
  it("removes duplicate file:line entries", () => {
    const usages = [
      { filePath: "a.ts", line: 5, column: 0, snippet: "first", context: "" },
      { filePath: "a.ts", line: 5, column: 0, snippet: "second", context: "" },
      { filePath: "a.ts", line: 10, column: 0, snippet: "third", context: "" },
    ];
    const result = dedup(usages);
    expect(result).toHaveLength(2);
    expect(result[0].snippet).toBe("first");
  });
});

describe("trackUrlVariables", () => {
  it("tracks assignments matching API path patterns", () => {
    const lines = [
      'BASE_URL = "https://api.example.com/v1/users"',
      'other = "nothing"',
      'endpoint = "/v1/orders/123"',
    ];
    const regexes = buildPathRegexes(["/v1/users", "/v1/orders"]);
    const assignment = /^\s*(\w+)\s*=\s*["'](.+?)["']/;

    const tracked = trackUrlVariables(lines, regexes, assignment);
    expect(tracked.has("BASE_URL")).toBe(true);
    expect(tracked.has("endpoint")).toBe(true);
    expect(tracked.has("other")).toBe(false);
  });

  it("returns empty map when no matches", () => {
    const lines = ['x = "hello"', 'y = 42'];
    const regexes = buildPathRegexes(["/v1/users"]);
    const assignment = /^\s*(\w+)\s*=\s*["'](.+?)["']/;

    const tracked = trackUrlVariables(lines, regexes, assignment);
    expect(tracked.size).toBe(0);
  });
});

describe("lineUsesTrackedVar", () => {
  it("detects tracked variable on a line", () => {
    const tracked = new Map([
      ["baseURL", { lineIndex: 0, value: "/v1/users" }],
    ]);
    expect(lineUsesTrackedVar("http.Get(baseURL)", tracked)).toBe("baseURL");
  });

  it("returns undefined when no tracked var present", () => {
    const tracked = new Map([
      ["baseURL", { lineIndex: 0, value: "/v1/users" }],
    ]);
    expect(lineUsesTrackedVar('http.Get("https://other.com")', tracked)).toBeUndefined();
  });

  it("skips very short variable names", () => {
    const tracked = new Map([
      ["x", { lineIndex: 0, value: "/v1/users" }],
    ]);
    expect(lineUsesTrackedVar("do_something(x)", tracked)).toBeUndefined();
  });

  it("matches whole words only", () => {
    const tracked = new Map([
      ["url", { lineIndex: 0, value: "/v1/users" }],
    ]);
    expect(lineUsesTrackedVar("urlBuilder.build()", tracked)).toBeUndefined();
    expect(lineUsesTrackedVar("fetch(url)", tracked)).toBe("url");
  });
});

describe("joinContinuationLines", () => {
  it("joins lines ending with backslash", () => {
    const lines = [
      "result = func(\\",
      "    arg1,\\",
      "    arg2)",
      "other = 1",
    ];
    const logical = joinContinuationLines(lines, (current, prev) =>
      prev.trimEnd().endsWith("\\"),
    );
    expect(logical.length).toBe(2);
    expect(logical[0].text).toContain("arg1");
    expect(logical[0].text).toContain("arg2");
    expect(logical[0].startLine).toBe(0);
    expect(logical[0].endLine).toBe(2);
  });

  it("handles single-line statements", () => {
    const lines = ["a = 1", "b = 2"];
    const logical = joinContinuationLines(lines, () => false);
    expect(logical).toHaveLength(2);
    expect(logical[0].text).toBe("a = 1");
  });
});
