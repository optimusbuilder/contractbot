import { describe, expect, it } from "vitest";
import { runVerification } from "../src/verification.js";

describe("runVerification", () => {
  it("reports a successful configured command", async () => {
    const result = await runVerification({ command: 'node -e "process.exit(0)"' });
    expect(result).toMatchObject({ passed: true, command: 'node -e "process.exit(0)"' });
  });

  it("captures output from a failed configured command", async () => {
    const result = await runVerification({ command: 'node -e "console.error(\'integration failed\'); process.exit(1)"' });
    expect(result.passed).toBe(false);
    expect(result.output).toContain("integration failed");
  });
});
