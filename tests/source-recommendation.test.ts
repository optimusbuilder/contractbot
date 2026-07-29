import { describe, expect, it } from "vitest";
import { parseSourceRecommendation } from "../src/investigator/index.js";

describe("parseSourceRecommendation", () => {
  it("marks AI source output as an untrusted candidate", () => {
    expect(parseSourceRecommendation('{"contract":"sdk_package","source":"@browserbasehq/sdk","rationale":"The cited import matches this package."}')).toEqual({ contract: "sdk_package", source: "@browserbasehq/sdk", trust: "ai_candidate", rationale: "The cited import matches this package." });
  });
});
