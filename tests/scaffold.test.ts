import { describe, expect, it } from "vitest";
import { parseVerificationScaffold } from "../src/investigator/index.js";

describe("parseVerificationScaffold", () => {
  it("accepts only a safety-classified scaffold with exact evidence citations", () => {
    const evidence = [{ file: "src/voice.ts", line: 12, kind: "http_request", value: "https://api.elevenlabs.io/v1/voices" }];
    const response = JSON.stringify({ summary: "Verify the read path.", safety: "read_only", requiredEnv: ["ELEVENLABS_API_KEY"], targetFile: "tests/elevenlabs.test.ts", testCommand: "npm test", citedEvidence: evidence, steps: ["Use a test account."], draft: "test(...)" });
    expect(parseVerificationScaffold(response, evidence)?.safety).toBe("read_only");
  });
});
