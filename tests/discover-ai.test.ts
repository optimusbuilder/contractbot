import { describe, expect, it } from "vitest";
import { clusterIntegrationEvidence, filterAiSuggestions, selectAgentClusters, validateAgentCandidates } from "../src/cli/commands/discover.js";

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

  it("normalizes an AI provider alias that cites a catalogued SDK", () => {
    const response = JSON.stringify({ candidates: [
      { provider: "google", classification: "sdk_client", confidence: "high", evidence: [{ file: "src/app.ts", line: 1, kind: "sdk_import", value: "@google/generative-ai" }], suggestedContractKind: "sdk_package", sourceConfidence: "high" },
    ] });
    expect(validateAgentCandidates(response, [{ file: "src/app.ts", line: 1, kind: "sdk_import", value: "@google/generative-ai" }]).candidates).toMatchObject([{ provider: "gemini" }]);
  });

  it("rejects candidates supported only by environment variables", () => {
    const response = JSON.stringify({ candidates: [
      { provider: "deepgram", classification: "external_api", confidence: "high", evidence: [{ file: "scripts/export.py", line: 1, kind: "environment_variable", value: "DEEPGRAM_API_KEY" }], suggestedContractKind: "unknown", sourceConfidence: "high" },
    ] });
    expect(validateAgentCandidates(response, [{ file: "scripts/export.py", line: 1, kind: "environment_variable", value: "DEEPGRAM_API_KEY" }]).candidates).toEqual([]);
  });
});

describe("clusterIntegrationEvidence", () => {
  it("keeps related evidence in a cited file cluster and prioritizes HTTP evidence", () => {
    const clusters = clusterIntegrationEvidence([
      { kind: "sdk_import", value: "@aws-sdk/client-bedrock-runtime", file: "lib/bedrock.ts", line: 1 },
      { kind: "environment_variable", value: "AWS_REGION", file: "lib/bedrock.ts", line: 2 },
      { kind: "http_request", value: "https://api.example.dev", file: "app/route.ts", line: 3 },
    ]);
    expect(clusters[0]).toEqual([{ kind: "http_request", value: "https://api.example.dev", file: "app/route.ts", line: 3 }]);
    expect(clusters[1]).toHaveLength(2);
  });

  it("reserves cluster coverage for Python and Dart evidence", () => {
    const clusters = selectAgentClusters([
      { kind: "sdk_import", value: "openai", file: "backend/client.py", line: 1 },
      { kind: "sdk_import", value: "firebase", file: "mobile/client.dart", line: 1 },
      { kind: "sdk_import", value: "react", file: "web/app.tsx", line: 1 },
      { kind: "http_request", value: "https://api.example.dev", file: "web/route.ts", line: 1 },
    ], 3);
    expect(clusters.flat().map((item) => item.file)).toEqual(expect.arrayContaining(["backend/client.py", "mobile/client.dart", "web/route.ts"]));
  });
});
