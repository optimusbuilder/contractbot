import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { buildIntegrationEvidence } from "../src/investigator/index.js";

const DIR = join(process.cwd(), ".test-integration-evidence");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("buildIntegrationEvidence", () => {
  it("distinguishes SDKs, HTTP calls, navigation, and static assets", async () => {
    await mkdir(join(DIR, "src"), { recursive: true });
    await writeFile(join(DIR, "src", "client.tsx"), `import { Browserbase } from "@browserbasehq/sdk";\nconst key = process.env.BROWSERBASE_API_KEY;\nfetch("https://api.elevenlabs.io/v1/voices");\npage.goto("https://craigslist.org");\nconst image = <img src="https://images.unsplash.com/a.jpg" />;`);
    const evidence = await buildIntegrationEvidence(DIR);

    expect(evidence.map((item) => item.kind)).toEqual(expect.arrayContaining(["sdk_import", "environment_variable", "http_request", "browser_navigation", "static_asset"]));
  });
});
