import { describe, expect, it } from "vitest";
import { normalizeProviderFromEvidence } from "../src/investigator/index.js";

describe("normalizeProviderFromEvidence", () => {
  it("maps AWS Bedrock, Browserbase, and LangChain Gemini SDKs", () => {
    expect(normalizeProviderFromEvidence("aws-sdk", [{ kind: "sdk_import", value: "@aws-sdk/client-bedrock-runtime" }])).toBe("aws-bedrock");
    expect(normalizeProviderFromEvidence("browserbasehq", [{ kind: "sdk_import", value: "@browserbasehq/sdk" }])).toBe("browserbase");
    expect(normalizeProviderFromEvidence("langchain-google-genai", [{ kind: "sdk_import", value: "@langchain/google-genai" }])).toBe("gemini");
  });
});
