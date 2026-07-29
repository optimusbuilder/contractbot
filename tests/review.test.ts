import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { loadDiscoveryReview, saveDiscoveryReview } from "../src/investigator/index.js";

const DIR = join(process.cwd(), ".test-review-queue");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("discovery review queue", () => {
  it("persists validated findings separately from configuration", async () => {
    await mkdir(DIR, { recursive: true });
    const path = await saveDiscoveryReview(DIR, [{ provider: "browserbase" }]);
    expect(path).toContain(".contractbot/reviews/discovery.json");
    expect(await loadDiscoveryReview(DIR)).toMatchObject({ candidates: [{ provider: "browserbase" }] });
  });
});
