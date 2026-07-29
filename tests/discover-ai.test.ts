import { describe, expect, it } from "vitest";
import { filterAiSuggestions } from "../src/cli/commands/discover.js";

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
