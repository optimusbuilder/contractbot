import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { buildCachedIntegrationEvidence } from "../src/investigator/index.js";

const DIR = join(process.cwd(), ".test-integration-cache");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("cached integration evidence", () => {
  it("reuses unchanged evidence and invalidates changed files", async () => {
    await mkdir(join(DIR, "src"), { recursive: true });
    const file = join(DIR, "src", "client.ts");
    await writeFile(file, 'fetch("https://api.one.dev")');
    expect((await buildCachedIntegrationEvidence(DIR)).map((item) => item.value)).toContain("https://api.one.dev");
    expect((await buildCachedIntegrationEvidence(DIR)).map((item) => item.value)).toContain("https://api.one.dev");
    await writeFile(file, 'fetch("https://api.two.dev")');
    expect((await buildCachedIntegrationEvidence(DIR)).map((item) => item.value)).toContain("https://api.two.dev");
  });
});
