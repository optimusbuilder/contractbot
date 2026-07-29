import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { setupCommand } from "../src/cli/commands/setup.js";
import { initCommand } from "../src/cli/commands/init.js";
import { logger } from "../src/logger.js";
import { isSupportedByEvidence } from "../src/cli/commands/setup.js";
import { buildGithubActionYaml } from "../src/output/github-action.js";

const TEST_DIR = join(process.cwd(), ".test-setup-tmp");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  await writeFile(
    join(TEST_DIR, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: { stripe: "^14.0.0" } }),
    "utf-8",
  );
  logger.configure({ format: "json", level: "error" });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
  logger.configure({ format: "human", level: "info" });
});

describe("setupCommand", () => {
  it("writes config without a Petstore placeholder", async () => {
    await setupCommand({ dir: TEST_DIR, skipDetect: true });

    const configPath = join(TEST_DIR, ".contractbot.yml");
    expect(existsSync(configPath)).toBe(true);
    const yaml = await readFile(configPath, "utf-8");
    expect(yaml).not.toContain("petstore");
    expect(yaml).toMatch(/apis:\s*\[\]|apis:\s*$/m);

    expect(existsSync(join(TEST_DIR, ".github", "workflows", "contractbot.yml"))).toBe(false);
  });

  it("detects stripe from package.json and resolves", async () => {
    await mkdir(join(TEST_DIR, "src"), { recursive: true });
    await writeFile(join(TEST_DIR, "src", "payments.ts"), 'import Stripe from "stripe";\nnew Stripe("test");', "utf-8");
    await setupCommand({ dir: TEST_DIR });

    const yaml = await readFile(join(TEST_DIR, ".contractbot.yml"), "utf-8");
    expect(yaml).toContain("stripe");
    expect(yaml).toMatch(/openapi|sdk_package/);
    expect(existsSync(join(TEST_DIR, ".github", "workflows", "contractbot.yml"))).toBe(true);
  });
});

describe("initCommand", () => {
  it("writes empty apis when nothing detected", async () => {
    await rm(join(TEST_DIR, "package.json"));
    await initCommand({ dir: TEST_DIR, skipDetect: true });

    const yaml = await readFile(join(TEST_DIR, ".contractbot.yml"), "utf-8");
    expect(yaml).not.toContain("petstore");
    expect(yaml).not.toContain("example-api");
  });
});

describe("setup evidence admission", () => {
  it("does not admit an env-only provider without an SDK or API call", () => {
    expect(isSupportedByEvidence(
      { name: "openai", hosts: ["https://api.openai.com"], packages: ["openai"], evidence: [], confidence: "low", scanPaths: [], needsResolve: false },
      [{ kind: "environment_variable", value: "OPENAI_API_KEY", file: "src/env.ts", line: 1, context: "process.env.OPENAI_API_KEY" }],
    )).toBe(false);
  });

  it("admits a provider with a matching HTTP request", () => {
    expect(isSupportedByEvidence(
      { name: "elevenlabs", hosts: ["https://api.elevenlabs.io"], packages: [], evidence: [], confidence: "high", scanPaths: [], needsResolve: false },
      [{ kind: "http_request", value: "https://api.elevenlabs.io/v1/voices", file: "src/voice.ts", line: 1, context: "fetch(...)" }],
    )).toBe(true);
  });
});

describe("generated GitHub workflow", () => {
  it("uses the release action without assuming a Node consumer repository", () => {
    const workflow = buildGithubActionYaml();
    expect(workflow).toContain("uses: optimusbuilder/contractbot@v0");
    expect(workflow).not.toContain("npm ci");
    expect(workflow).toContain("cron: '17 */4 * * *'");
  });
});
