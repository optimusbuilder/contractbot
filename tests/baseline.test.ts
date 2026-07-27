import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import {
  clearChangeSet,
  getBaseline,
  getChangeSet,
  saveBaseline,
  saveChangeSet,
} from "../src/differ/index.js";

const API = "baseline-test-api";
const SPEC = { openapi: "3.0.0", info: { version: "1" }, paths: {} };

afterEach(async () => {
  await clearChangeSet(API);
  const path = ".contractbot/baselines/baseline-test-api.json";
  if (existsSync(path)) await rm(path);
});

describe("approved baselines and pending change-sets", () => {
  it("keeps the approved baseline separate from a detected change", async () => {
    const baseline = await saveBaseline(API, "https://example.com/openapi.json", SPEC);
    const nextSpec = { ...SPEC, info: { version: "2" } };

    await saveChangeSet({
      apiName: API,
      sourceUrl: baseline.sourceUrl,
      detectedAt: "2026-07-27T00:00:00.000Z",
      baseline,
      nextSpec,
      diff: {
        apiName: API,
        oldVersion: "1",
        newVersion: "2",
        changes: [],
        breakingCount: 0,
        nonBreakingCount: 0,
      },
    });

    expect((await getBaseline(API))?.spec.info?.version).toBe("1");
    expect((await getChangeSet(API))?.nextSpec.info?.version).toBe("2");
  });

  it("clears a pending change-set without touching the baseline", async () => {
    const baseline = await saveBaseline(API, "https://example.com/openapi.json", SPEC);
    await saveChangeSet({
      apiName: API,
      sourceUrl: baseline.sourceUrl,
      detectedAt: "2026-07-27T00:00:00.000Z",
      baseline,
      nextSpec: SPEC,
      diff: { apiName: API, changes: [], breakingCount: 0, nonBreakingCount: 0 },
    });

    await clearChangeSet(API);

    expect(await getChangeSet(API)).toBeNull();
    expect(await getBaseline(API)).not.toBeNull();
  });
});
