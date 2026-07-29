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
  it("uses the requested release action without assuming the consumer uses Node", () => {
    const yaml = buildGithubActionYaml("v0");
    expect(yaml).toContain("uses: optimusbuilder/contractbot@v0");
    expect(yaml).toContain("fail-on: breaking");
    expect(yaml).toContain("contents: read");
    expect(yaml).toContain("17 */4 * * *");
    expect(yaml).not.toContain("npm ci");
    expect(yaml).not.toContain("actions/setup-node");
  });

  it("uses the supplied action ref", () => {
    const yaml = buildGithubActionYaml("latest");
    expect(yaml).toContain("uses: optimusbuilder/contractbot@latest");
  });
});

describe("writeGithubAction", () => {
  it("writes the workflow file", async () => {
    const result = await writeGithubAction({ dir: TEST_DIR, ref: "v0" });
    expect(result.created).toBe(true);
    expect(result.skipped).toBe(false);
    expect(existsSync(join(TEST_DIR, GITHUB_ACTION_RELATIVE_PATH))).toBe(true);

    const body = await readFile(result.path, "utf-8");
    expect(body).toContain("contractbot@v0");
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
      ref: "v0",
    });
    expect(forced.created).toBe(true);
    expect(await readFile(path, "utf-8")).toContain("contractbot@v0");
  });
});
