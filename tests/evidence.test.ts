import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { collectDiscoveryEvidence } from "../src/detector/index.js";

const DIR = join(process.cwd(), ".test-evidence-tmp");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("collectDiscoveryEvidence", () => {
  it("collects identifiers without sending source content", async () => {
    await mkdir(join(DIR, "src"), { recursive: true });
    await writeFile(join(DIR, "package.json"), JSON.stringify({ dependencies: { "@google/generative-ai": "1" } }));
    await writeFile(join(DIR, "src", "client.ts"), 'const key = process.env.GEMINI_API_KEY; fetch("https://api.elevenlabs.io/v1/voices");');
    expect(await collectDiscoveryEvidence(DIR)).toEqual({
      packages: ["@google/generative-ai"],
      environmentVariables: ["GEMINI_API_KEY"],
      hosts: ["api.elevenlabs.io"],
    });
  });
});
