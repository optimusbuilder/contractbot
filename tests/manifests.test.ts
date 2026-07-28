import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { collectManifestDependencies } from "../src/detector/index.js";

const DIR = join(process.cwd(), ".test-manifests-tmp");
afterEach(async () => { if (existsSync(DIR)) await rm(DIR, { recursive: true }); });

describe("collectManifestDependencies", () => {
  it("collects nested Node, Python, and Flutter dependencies", async () => {
    await mkdir(join(DIR, "backend"), { recursive: true });
    await mkdir(join(DIR, "desktop"), { recursive: true });
    await mkdir(join(DIR, "mobile"), { recursive: true });
    await writeFile(join(DIR, "backend", "requirements.txt"), "openai>=1\npinecone\n");
    await writeFile(join(DIR, "desktop", "package.json"), JSON.stringify({ dependencies: { "@google/adk": "1", mongodb: "1" } }));
    await writeFile(join(DIR, "mobile", "pubspec.yaml"), "dependencies:\n  firebase_core: ^3.0.0\n  posthog_flutter: ^4.0.0\n");

    expect(await collectManifestDependencies(DIR)).toEqual(expect.arrayContaining(["openai", "pinecone", "@google/adk", "mongodb", "firebase_core", "posthog_flutter"]));
  });
});
