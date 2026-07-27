import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { detectApis, candidateToApiEntry } from "../src/detector/index.js";
import { normalizeApiEntry, getOpenApiUrl } from "../src/config/schema.js";

const TEST_DIR = join(process.cwd(), ".test-discover-tmp");

beforeEach(async () => {
  await mkdir(join(TEST_DIR, "src"), { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("detectApis — no whitelist gate", () => {
  it("keeps Supabase even without OpenAPI (sdk_package contract)", async () => {
    await writeFile(
      join(TEST_DIR, "package.json"),
      JSON.stringify({
        dependencies: {
          "@supabase/supabase-js": "^2.0.0",
          stripe: "^14.0.0",
        },
      }),
      "utf-8",
    );

    const result = await detectApis(TEST_DIR);
    const names = result.candidates.map((c) => c.name);

    expect(names).toContain("supabase");
    expect(names).toContain("stripe");

    const supabase = result.candidates.find((c) => c.name === "supabase")!;
    expect(supabase.suggestedContract?.type).toBe("sdk_package");
    expect(supabase.needsResolve).toBe(false);
  });

  it("creates a candidate for unknown API hosts", async () => {
    await writeFile(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "app" }),
      "utf-8",
    );
    await writeFile(
      join(TEST_DIR, "src/client.ts"),
      `const res = await fetch("https://api.acme.dev/v1/things");\n`,
      "utf-8",
    );

    const result = await detectApis(TEST_DIR);
    const acme = result.candidates.find(
      (c) => c.name === "acme" || c.hosts.some((h) => h.includes("acme.dev")),
    );

    expect(acme).toBeDefined();
    expect(acme!.needsResolve).toBe(true);
    expect(
      acme!.suggestedContract === undefined ||
        acme!.suggestedContract.type === "unresolved",
    ).toBe(true);
  });

  it("candidateToApiEntry writes unresolved APIs into config shape", async () => {
    await writeFile(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ dependencies: { stripe: "1.0.0" } }),
      "utf-8",
    );

    const result = await detectApis(TEST_DIR);
    const stripe = result.candidates.find((c) => c.name === "stripe")!;
    const entry = candidateToApiEntry(stripe);

    expect(entry.contract?.type).toBe("openapi");
    expect(getOpenApiUrl(entry)).toBeTruthy();
    expect(entry.needs_resolve).toBe(false);
  });

  it("candidateToApiEntry for supabase uses sdk watch", async () => {
    await writeFile(
      join(TEST_DIR, "package.json"),
      JSON.stringify({
        dependencies: { "@supabase/supabase-js": "2.0.0" },
      }),
      "utf-8",
    );

    const result = await detectApis(TEST_DIR);
    const entry = candidateToApiEntry(
      result.candidates.find((c) => c.name === "supabase")!,
    );

    expect(entry.contract?.type).toBe("sdk_package");
    expect(entry.watch?.strategies).toContain("sdk_version");
    expect(entry.spec).toBeUndefined();
  });
});

describe("normalizeApiEntry", () => {
  it("upgrades legacy spec field to openapi contract", () => {
    const entry = normalizeApiEntry({
      name: "legacy",
      spec: "https://example.com/openapi.json",
      scan_paths: ["src/**"],
    });
    expect(entry.contract?.type).toBe("openapi");
    if (entry.contract?.type === "openapi") {
      expect(entry.contract.url).toBe("https://example.com/openapi.json");
    }
  });

  it("marks entries without contract as unresolved", () => {
    const entry = normalizeApiEntry({
      name: "mystery",
      scan_paths: ["src/**"],
    });
    expect(entry.needs_resolve).toBe(true);
    expect(entry.contract?.type).toBe("unresolved");
  });
});
