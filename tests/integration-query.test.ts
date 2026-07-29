import { describe, expect, it } from "vitest";
import { parseEvidenceQueries, queryIntegrationEvidence } from "../src/investigator/index.js";

const evidence = [
  { kind: "sdk_import" as const, value: "@browserbasehq/sdk", file: "app/scout.ts", line: 1, context: 'import { Browserbase } from "@browserbasehq/sdk"' },
  { kind: "environment_variable" as const, value: "BROWSERBASE_API_KEY", file: "app/scout.ts", line: 2, context: "process.env.BROWSERBASE_API_KEY" },
];

describe("integration evidence queries", () => {
  it("only accepts plans for known evidence identifiers", () => {
    const queries = parseEvidenceQueries('{"queries":[{"term":"@browserbasehq/sdk","kind":"sdk_import"},{"term":"invented"}]}', new Set(evidence.map((item) => item.value)));
    expect(queries).toEqual([{ term: "@browserbasehq/sdk", kind: "sdk_import" }]);
    expect(queryIntegrationEvidence(evidence, queries[0])).toEqual([evidence[0]]);
  });
});
