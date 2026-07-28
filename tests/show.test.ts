import { describe, expect, it } from "vitest";
import { formatChangeSet } from "../src/cli/commands/show.js";

describe("formatChangeSet", () => {
  it("renders contract evidence and verification for review", () => {
    const output = formatChangeSet({
      apiName: "stripe",
      sourceUrl: "https://example.com/openapi.json",
      detectedAt: "2026-07-27T00:00:00.000Z",
      baseline: {
        apiName: "stripe",
        sourceUrl: "https://example.com/openapi.json",
        acceptedAt: "2026-07-01T00:00:00.000Z",
        spec: { paths: {} },
      },
      nextSpec: { paths: {} },
      diff: {
        apiName: "stripe",
        oldVersion: "1",
        newVersion: "2",
        breakingCount: 1,
        nonBreakingCount: 0,
        changes: [{ severity: "breaking", path: "/v1/users", method: "get", description: "Field removed: id" }],
      },
      verification: {
        command: "npm run test:integration:stripe",
        passed: false,
        output: "Missing id",
      },
    });

    expect(output).toContain("stripe: pending API contract change");
    expect(output).toContain("Field removed: id");
    expect(output).toContain("npm run test:integration:stripe");
    expect(output).toContain("Missing id");
    expect(output).toContain("contractbot accept stripe");
  });
});
