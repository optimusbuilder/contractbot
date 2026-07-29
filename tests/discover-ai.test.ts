import { describe, expect, it } from "vitest";
import { filterAiSuggestions, validateAgentCandidates } from "../src/cli/commands/discover.js";

describe("filterAiSuggestions", () => {
  it("accepts evidence-backed canonical providers and rejects raw identifiers", () => {
    const response = JSON.stringify([
      { name: "vitallens", confidence: "high", evidence: ["api.vitallens.com", "VITALLENS_API_KEY"], suggestedType: "unknown" },
      { name: "express", confidence: "high", evidence: ["express"], suggestedType: "sdk_package" },
      { name: "GEMINI_API_KEY", confidence: "high", evidence: ["GEMINI_API_KEY"], suggestedType: "unknown" },
      { name: "gemini", confidence: "high", evidence: ["GEMINI_API_KEY"], suggestedType: "sdk_package" },
    ]);
    const suggestions = filterAiSuggestions(response, new Set(["gemini"]), new Set(["api.vitallens.com", "VITALLENS_API_KEY", "express", "GEMINI_API_KEY"]));

    expect(suggestions).toEqual([
      { name: "vitallens", confidence: "high", evidence: ["api.vitallens.com", "VITALLENS_API_KEY"], suggestedType: "unknown" },
    ]);
  });
});

describe("validateAgentCandidates", () => {
  it("retains only candidates with exact evidence citations", () => {
    const response = JSON.stringify({ candidates: [
      { provider: "browserbase", classification: "sdk_client", confidence: "high", evidence: [{ file: "app/scout.ts", line: 1, kind: "sdk_import", value: "@browserbasehq/sdk" }], suggestedContractKind: "sdk_package", sourceConfidence: "high" },
      { provider: "invented", classification: "external_api", confidence: "high", evidence: [{ file: "missing.ts", line: 1, kind: "sdk_import", value: "missing" }], suggestedContractKind: "unknown", sourceConfidence: "high" },
    ] });
    const result = validateAgentCandidates(response, [{ file: "app/scout.ts", line: 1, kind: "sdk_import", value: "@browserbasehq/sdk" }]);
    expect(result.candidates).toHaveLength(1);
  });

  it("rejects generic SDK classifications without a contract family", () => {
    const response = JSON.stringify({ candidates: [
      { provider: "framer-motion", classification: "sdk_client", confidence: "high", evidence: [{ file: "src/app.tsx", line: 1, kind: "sdk_import", value: "framer-motion" }], suggestedContractKind: "unknown", sourceConfidence: "high" },
    ] });
    expect(validateAgentCandidates(response, [{ file: "src/app.tsx", line: 1, kind: "sdk_import", value: "framer-motion" }]).candidates).toEqual([]);
  });
});
