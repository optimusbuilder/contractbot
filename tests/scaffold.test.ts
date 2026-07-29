import { describe, expect, it } from "vitest";
import { inspectTestRepository, parseVerificationScaffold } from "../src/investigator/index.js";
import { afterEach } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";

const DIR = join(process.cwd(), ".test-scaffold-profile");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("parseVerificationScaffold", () => {
  it("accepts only a safety-classified scaffold with exact evidence citations", () => {
    const evidence = [{ file: "src/voice.ts", line: 12, kind: "http_request", value: "https://api.elevenlabs.io/v1/voices" }];
    const response = JSON.stringify({ summary: "Verify the read path.", safety: "read_only", requiredEnv: ["ELEVENLABS_API_KEY"], targetFile: "tests/elevenlabs.test.ts", testCommand: "npm test", citedEvidence: evidence, steps: ["Use a test account."], draft: "test(...)" });
    expect(parseVerificationScaffold(response, evidence)?.safety).toBe("read_only");
  });

  it("rejects source targets, unknown imports, unsupported framework syntax, and unsafe read-only drafts", async () => {
    await mkdir(join(DIR, "tests"), { recursive: true });
    await writeFile(join(DIR, "package.json"), JSON.stringify({ devDependencies: { vitest: "1" }, scripts: { test: "vitest run" } }));
    await writeFile(join(DIR, "tests", "existing.test.ts"), 'import { it } from "vitest"; it("existing", () => {});');
    const profile = await inspectTestRepository(DIR);
    const evidence = [{ file: "backend/lib/gemini.js", line: 3, kind: "sdk_import", value: "@google/generative-ai" }];
    const response = JSON.stringify({ summary: "Verify Gemini.", safety: "read_only", requiredEnv: ["GEMINI_API_KEY"], targetFile: "backend/lib/gemini.js", testCommand: "npm test", citedEvidence: evidence, steps: [], draft: 'import fetchMock from "fetch-mock"; console.assert(true);' });
    expect(parseVerificationScaffold(response, evidence, profile)).toBeNull();
  });

  it("accepts a fully mocked draft using the detected test runner and installed imports", async () => {
    await mkdir(join(DIR, "tests"), { recursive: true });
    await writeFile(join(DIR, "package.json"), JSON.stringify({ devDependencies: { vitest: "1" }, scripts: { test: "vitest run" } }));
    const profile = await inspectTestRepository(DIR);
    const evidence = [{ file: "src/client.ts", line: 2, kind: "http_request", value: "https://example.test" }];
    const response = JSON.stringify({ summary: "Verify adapter behavior.", safety: "read_only", requiredEnv: [], targetFile: "tests/client.test.ts", testCommand: "npm test", citedEvidence: evidence, steps: ["Mock the adapter."], draft: 'import { expect, it, vi } from "vitest"; vi.mock("../src/client.js"); it("does not call the provider", () => expect(true).toBe(true));' });
    expect(parseVerificationScaffold(response, evidence, profile)?.targetFile).toBe("tests/client.test.ts");
  });

  it("requires cited local SDK construction when the draft imports that SDK", async () => {
    await mkdir(join(DIR, "tests"), { recursive: true });
    await writeFile(join(DIR, "package.json"), JSON.stringify({ devDependencies: { vitest: "1" }, dependencies: { "@google/generative-ai": "1" }, scripts: { test: "vitest run" } }));
    const profile = await inspectTestRepository(DIR);
    const importEvidence = { file: "backend/lib/gemini.js", line: 1, kind: "sdk_import", value: "@google/generative-ai" };
    const response = JSON.stringify({ summary: "Verify adapter behavior.", safety: "test_account_required", requiredEnv: ["GEMINI_API_KEY"], targetFile: "tests/gemini.test.js", testCommand: "npm test", citedEvidence: [importEvidence], steps: [], draft: 'import { GoogleGenerativeAI } from "@google/generative-ai"; import { it } from "vitest"; it("uses the local client", () => {});' });
    expect(parseVerificationScaffold(response, [importEvidence], profile)).toBeNull();
  });

  it("collects existing tests so drafts can follow local conventions", async () => {
    await mkdir(join(DIR, "tests"), { recursive: true });
    await writeFile(join(DIR, "package.json"), JSON.stringify({ devDependencies: { vitest: "1" }, scripts: { test: "vitest run" } }));
    await writeFile(join(DIR, "tests", "gemini.test.js"), 'import { it } from "vitest"; it("uses a local convention", () => {});');
    const profile = await inspectTestRepository(DIR);
    expect(profile.existingTests).toEqual([expect.objectContaining({ file: "tests/gemini.test.js", excerpt: expect.stringContaining('from "vitest"') })]);
  });
});
