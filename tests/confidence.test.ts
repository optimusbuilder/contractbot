import { describe, it, expect } from "vitest";
import { scorePatch, scorePatches } from "../src/healer/confidence.js";
import { FilePatch } from "../src/healer/healer.js";
import { ApiChange } from "../src/differ/types.js";

function makePatch(overrides: Partial<FilePatch> = {}): FilePatch {
  return {
    filePath: "src/api.ts",
    originalContent: 'const url = "/v1/users";\nfetch(url);',
    patchedContent: 'const url = "/v2/users";\nfetch(url);',
    description: "Update API path",
    ...overrides,
  };
}

function makeChange(overrides: Partial<ApiChange> = {}): ApiChange {
  return {
    severity: "breaking",
    path: "/v1/users",
    method: "get",
    description: "Field removed from response: name",
    field: "name",
    ...overrides,
  };
}

describe("scorePatch", () => {
  it("gives high confidence to small, simple patches with related changes", () => {
    const patch = makePatch();
    const changes = [makeChange({ path: "/v1/users" })];

    const scored = scorePatch(patch, changes);
    expect(scored.confidence).toBe("high");
    expect(scored.score).toBeGreaterThanOrEqual(75);
  });

  it("penalizes large diffs", () => {
    const bigOriginal = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const bigPatched = Array.from({ length: 100 }, (_, i) => `changed ${i}`).join("\n");

    const patch = makePatch({
      originalContent: bigOriginal,
      patchedContent: bigPatched,
    });
    const scored = scorePatch(patch, []);
    expect(scored.score).toBeLessThan(60);
    expect(scored.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Large change")]),
    );
  });

  it("penalizes patches with no related API changes", () => {
    const patch = makePatch();
    const scored = scorePatch(patch, []);
    expect(scored.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("No directly matching")]),
    );
  });

  it("boosts simple rename changes", () => {
    const patch = makePatch();
    const changes = [
      makeChange({
        description: "Field renamed from name to fullName",
        field: "fullName",
        path: "/v1/users",
      }),
    ];

    const withRename = scorePatch(
      makePatch({ patchedContent: 'const fullName = user.fullName;\nfetch("/v1/users");' }),
      changes,
    );
    expect(withRename.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Simple field rename")]),
    );
  });

  it("penalizes patches containing TODO comments", () => {
    const patch = makePatch({
      patchedContent: '// TODO: verify this change\nconst url = "/v2/users";',
    });
    const scored = scorePatch(patch, []);
    expect(scored.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("TODO")]),
    );
  });

  it("penalizes type changes", () => {
    const changes = [
      makeChange({
        description: "Field type changed: count (string → integer)",
        field: "count",
        path: "/v1/users",
      }),
    ];
    const patch = makePatch({
      patchedContent: 'const count: number = data.count;\nfetch("/v1/users");',
    });
    const scored = scorePatch(patch, changes);
    expect(scored.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("type changes")]),
    );
  });

  it("clamps score between 0 and 100", () => {
    const bigOriginal = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const bigPatched = Array.from({ length: 200 }, (_, i) => `changed ${i}`).join("\n");

    const scored = scorePatch(
      makePatch({
        originalContent: bigOriginal,
        patchedContent: bigPatched + "\n// TODO: fix this",
      }),
      [],
    );
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(100);
  });

  it("maps scores to correct confidence levels", () => {
    const highPatch = makePatch();
    const highChanges = [makeChange({ path: "/v1/users" })];
    const high = scorePatch(highPatch, highChanges);
    expect(["high", "medium"]).toContain(high.confidence);

    const bigOriginal = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    const bigPatched = Array.from({ length: 200 }, (_, i) => `changed ${i}`).join("\n");
    const low = scorePatch(
      makePatch({
        originalContent: bigOriginal,
        patchedContent: bigPatched + "\n// TODO",
      }),
      [],
    );
    expect(low.confidence).toBe("low");
  });
});

describe("scorePatches", () => {
  it("scores multiple patches at once", () => {
    const patches = [
      makePatch({ filePath: "a.ts" }),
      makePatch({ filePath: "b.ts" }),
    ];
    const changes = [makeChange()];

    const scored = scorePatches(patches, changes);
    expect(scored).toHaveLength(2);
    expect(scored[0].filePath).toBe("a.ts");
    expect(scored[1].filePath).toBe("b.ts");
    expect(scored.every((s) => typeof s.score === "number")).toBe(true);
  });

  it("returns empty array for empty input", () => {
    expect(scorePatches([], [])).toHaveLength(0);
  });
});
