import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { loadDiscoveryReview, saveDiscoveryReview } from "../src/investigator/index.js";
import { reviewCommand } from "../src/cli/commands/review.js";
import { loadConfig } from "../src/config/loader.js";

const DIR = join(process.cwd(), ".test-review-queue");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("discovery review queue", () => {
  it("persists validated findings separately from configuration", async () => {
    await mkdir(DIR, { recursive: true });
    const path = await saveDiscoveryReview(DIR, [{ provider: "browserbase" }]);
    expect(path).toContain(".contractbot/reviews/discovery.json");
    expect(await loadDiscoveryReview(DIR)).toMatchObject({ candidates: [{ provider: "browserbase" }] });
  });

  it("requires a manual source before adding a reviewed provider", async () => {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, ".contractbot.yml"), "apis: []\n", "utf-8");
    await saveDiscoveryReview(DIR, [{ provider: "browserbase" }]);

    await reviewCommand("add", "browserbase", { dir: DIR, contract: "sdk_package", source: "@browserbasehq/sdk" });

    const config = await loadConfig(join(DIR, ".contractbot.yml"));
    expect(config.apis[0]?.contract).toMatchObject({ type: "sdk_package", package: "@browserbasehq/sdk", resolved_via: "manual" });
  });

  it("persists an internal decision without adding a monitored API", async () => {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, ".contractbot.yml"), "apis: []\n", "utf-8");
    await saveDiscoveryReview(DIR, [{ provider: "internal-gateway" }]);

    await reviewCommand("internal", "internal-gateway", { dir: DIR });

    expect((await loadConfig(join(DIR, ".contractbot.yml"))).discovery?.internal).toContain("internal-gateway");
  });

  it("initializes configuration when an explicit review decision is made first", async () => {
    await mkdir(DIR, { recursive: true });
    await saveDiscoveryReview(DIR, [{ provider: "first-provider" }]);

    await reviewCommand("add", "first-provider", { dir: DIR, contract: "sdk_package", source: "first-provider-sdk" });

    expect((await loadConfig(join(DIR, ".contractbot.yml"))).apis[0]?.name).toBe("first-provider");
  });
});
