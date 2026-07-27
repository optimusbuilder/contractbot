import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { setupCommand } from "../src/cli/commands/setup.js";
import { initCommand } from "../src/cli/commands/init.js";
import { GITHUB_ACTION_RELATIVE_PATH } from "../src/output/github-action.js";
import { logger } from "../src/logger.js";

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
  it("writes config + GitHub Action without Petstore placeholder", async () => {
    await setupCommand({ dir: TEST_DIR, skipDetect: true });

    const configPath = join(TEST_DIR, ".contractbot.yml");
    expect(existsSync(configPath)).toBe(true);
    const yaml = await readFile(configPath, "utf-8");
    expect(yaml).not.toContain("petstore");
    expect(yaml).toMatch(/apis:\s*\[\]|apis:\s*$/m);

    expect(existsSync(join(TEST_DIR, GITHUB_ACTION_RELATIVE_PATH))).toBe(true);
  });

  it("detects stripe from package.json and resolves", async () => {
    await setupCommand({ dir: TEST_DIR });

    const yaml = await readFile(join(TEST_DIR, ".contractbot.yml"), "utf-8");
    expect(yaml).toContain("stripe");
    expect(yaml).toMatch(/openapi|sdk_package/);
    expect(existsSync(join(TEST_DIR, GITHUB_ACTION_RELATIVE_PATH))).toBe(true);
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
