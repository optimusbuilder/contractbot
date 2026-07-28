import { describe, expect, it } from "vitest";
import { readFile } from "fs/promises";
import { parse } from "yaml";

describe("GitHub Action manifest", () => {
  it("is a composite action that builds and runs Contractbot from its source", async () => {
    const manifest = parse(await readFile("action.yml", "utf-8")) as {
      inputs?: Record<string, { default?: string }>;
      runs?: { using?: string; steps?: Array<Record<string, string>> };
    };

    expect(manifest.inputs?.config?.default).toBe(".contractbot.yml");
    expect(manifest.inputs?.["fail-on"]?.default).toBe("breaking");
    expect(manifest.runs?.using).toBe("composite");
    expect(manifest.runs?.steps?.some((step) => step.run?.includes("npm run build --prefix \"$GITHUB_ACTION_PATH\""))).toBe(true);
    expect(manifest.runs?.steps?.some((step) => step.run?.includes("dist/cli/index.js\" ci"))).toBe(true);
    expect(manifest.runs?.steps?.some((step) => step.uses === "actions/upload-artifact@v4")).toBe(true);
  });
});
