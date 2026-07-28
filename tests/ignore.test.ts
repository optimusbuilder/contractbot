import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { rm, writeFile } from "fs/promises";
import { ignoreCommand } from "../src/cli/commands/ignore.js";
import { loadConfig } from "../src/config/loader.js";

const CONFIG = ".test-ignore.yml";

afterEach(async () => {
  if (existsSync(CONFIG)) await rm(CONFIG);
});

describe("ignoreCommand", () => {
  it("persists an ignored discovery candidate and removes its API entry", async () => {
    await writeFile(CONFIG, "apis:\n  - name: acme\n    scan_paths: []\n", "utf-8");
    await ignoreCommand("acme", { config: CONFIG });

    const config = await loadConfig(CONFIG);
    expect(config.apis).toEqual([]);
    expect(config.discovery?.ignore).toEqual(["acme"]);
  });
});
