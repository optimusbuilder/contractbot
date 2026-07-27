import { mkdir, writeFile, readdir } from "fs/promises";
import { join } from "path";
import { createTwoFilesPatch } from "diff";
import { FilePatch, HealResult } from "../healer/index.js";

const PATCHES_DIR = ".contractbot/patches";

export async function savePatch(result: HealResult): Promise<string> {
  await mkdir(PATCHES_DIR, { recursive: true });

  const timestamp = new Date().toISOString().slice(0, 10);
  const patchId = `${result.apiName}-${timestamp}`;
  const patchDir = join(PATCHES_DIR, patchId);
  await mkdir(patchDir, { recursive: true });

  const unifiedDiff = result.patches
    .map((p) => createFileDiff(p))
    .join("\n");

  await writeFile(join(patchDir, "changes.patch"), unifiedDiff, "utf-8");

  const metadata = {
    apiName: result.apiName,
    createdAt: new Date().toISOString(),
    changes: result.changes.length,
    breakingChanges: result.changes.filter((c) => c.severity === "breaking")
      .length,
    filesAffected: result.patches.length,
    files: result.patches.map((p) => ({
      path: p.filePath,
      description: p.description,
    })),
    summary: result.summary,
  };

  await writeFile(
    join(patchDir, "metadata.json"),
    JSON.stringify(metadata, null, 2),
    "utf-8",
  );

  for (const patch of result.patches) {
    const safeFileName = patch.filePath.replace(/[/\\]/g, "__");
    await writeFile(
      join(patchDir, `patched-${safeFileName}`),
      patch.patchedContent,
      "utf-8",
    );
  }

  return patchId;
}

export async function listPatches(): Promise<string[]> {
  try {
    const entries = await readdir(PATCHES_DIR);
    return entries;
  } catch {
    return [];
  }
}

function createFileDiff(patch: FilePatch): string {
  return createTwoFilesPatch(
    patch.filePath,
    patch.filePath,
    patch.originalContent,
    patch.patchedContent,
    "original",
    "patched",
  );
}
