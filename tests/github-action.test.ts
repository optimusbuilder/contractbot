import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import {
  buildGithubActionYaml,
  writeGithubAction,
  GITHUB_ACTION_RELATIVE_PATH,
} from "../src/output/github-action.js";

const TEST_DIR = join(process.cwd(), ".test-github-action-tmp");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("buildGithubActionYaml", () => {
  it("pins npx to a version", () => {
    const yaml = buildGithubActionYaml("0.1.0");
    expect(yaml).toContain("npx contractbot@0.1.0 ci");
    expect(yaml).toContain("--fail-on breaking");
    expect(yaml).not.toContain("npx contractbot@0.1.0 pr");
    expect(yaml).toContain(".contractbot/changes");
    expect(yaml).toContain("contents: read");
    expect(yaml).not.toContain("github-script");
    expect(yaml).not.toContain("pull-requests: write");
    expect(yaml).toContain("*/15 * * * *");
  });

  it("uses unversioned package for latest", () => {
    const yaml = buildGithubActionYaml("latest");
    expect(yaml).toContain("npx contractbot ci");
    expect(yaml).not.toContain("npx contractbot@latest");
  });
});

describe("writeGithubAction", () => {
  it("writes the workflow file", async () => {
    const result = await writeGithubAction({ dir: TEST_DIR, version: "0.1.0" });
    expect(result.created).toBe(true);
    expect(result.skipped).toBe(false);
    expect(existsSync(join(TEST_DIR, GITHUB_ACTION_RELATIVE_PATH))).toBe(true);

    const body = await readFile(result.path, "utf-8");
    expect(body).toContain("contractbot@0.1.0");
  });

  it("skips when file exists unless force", async () => {
    const path = join(TEST_DIR, GITHUB_ACTION_RELATIVE_PATH);
    await mkdir(join(TEST_DIR, ".github", "workflows"), { recursive: true });
    await writeFile(path, "existing", "utf-8");

    const skipped = await writeGithubAction({ dir: TEST_DIR });
    expect(skipped.skipped).toBe(true);
    expect(await readFile(path, "utf-8")).toBe("existing");

    const forced = await writeGithubAction({
      dir: TEST_DIR,
      force: true,
      version: "0.1.0",
    });
    expect(forced.created).toBe(true);
    expect(await readFile(path, "utf-8")).toContain("contractbot@0.1.0");
  });
});
