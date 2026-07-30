import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { ciCommand } from "../src/cli/commands/ci.js";
import {
  clearChangeSet,
  cacheSpec,
  getBaseline,
  getChangeSet,
  saveBaseline,
} from "../src/differ/index.js";

const API = "ci-command-test-api";
const CONFIG = ".test-ci-command.yml";

afterEach(async () => {
  vi.restoreAllMocks();
  await clearChangeSet(API);
  for (const path of [
    `.contractbot/baselines/${API}.json`,
    `.contractbot/cache/${API}.json`,
    `.contractbot/cache/${API}.meta.json`,
    CONFIG,
  ]) {
    if (existsSync(path)) await rm(path);
  }
});

describe("ciCommand", () => {
  it("records a changed contract without replacing the approved baseline", async () => {
    await saveBaseline(API, "https://example.com/openapi.json", {
      openapi: "3.0.0",
      info: { version: "1" },
      paths: { "/users": { get: { responses: {} } } },
    });
    await writeFile(
      CONFIG,
      `apis:\n  - name: ${API}\n    contract:\n      type: openapi\n      url: https://example.com/openapi.json\n    scan_paths: []\n    verify:\n      command: node -e "process.exit(0)"\n`,
      "utf-8",
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        openapi: "3.0.0",
        info: { version: "2" },
        paths: {},
      }),
    })));

    await ciCommand({ config: CONFIG, failOn: "none" });

    expect((await getBaseline(API))?.spec.info?.version).toBe("1");
    const changeSet = await getChangeSet(API);
    expect(changeSet?.nextSpec.info?.version).toBe("2");
    expect(changeSet?.diff.breakingCount).toBe(1);
    expect(changeSet?.verification?.passed).toBe(true);
  });

  it("compares a cached spec when the provider returns 304", async () => {
    await saveBaseline(API, "https://example.com/openapi.json", {
      openapi: "3.0.0",
      info: { version: "1" },
      paths: { "/users": { get: { responses: {} } }, "/removed": { get: { responses: {} } } },
    });
    await cacheSpec(API, {
      openapi: "3.0.0",
      info: { version: "1" },
      paths: { "/users": { get: { responses: {} } } },
    }, { etag: "unchanged" });
    await writeFile(
      CONFIG,
      `apis:\n  - name: ${API}\n    contract:\n      type: openapi\n      url: https://example.com/openapi.json\n    scan_paths: []\n`,
      "utf-8",
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 304, headers: { get: () => null } })));

    await ciCommand({ config: CONFIG, failOn: "none" });

    expect((await getChangeSet(API))?.diff.breakingCount).toBe(1);
  });
});
