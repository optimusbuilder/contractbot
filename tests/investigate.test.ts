import { describe, expect, it } from "vitest";
import { parseInvestigation } from "../src/cli/commands/investigate.js";

describe("parseInvestigation", () => {
  it("retains only affected locations supported by deterministic evidence", () => {
    const result = parseInvestigation(JSON.stringify({
      summary: "The request may be affected.",
      relevance: "high",
      affectedUsages: [{ file: "src/payments.ts", line: 12, reason: "Uses the changed endpoint" }, { file: "invented.ts", line: 1, reason: "No evidence" }],
      verificationCoverage: "partial",
      recommendedActions: ["Run the configured verification."],
    }), [{ file: "src/payments.ts", line: 12 }]);

    expect(result.affectedUsages).toEqual([{ file: "src/payments.ts", line: 12, reason: "Uses the changed endpoint" }]);
    expect(result.relevance).toBe("high");
  });
});
