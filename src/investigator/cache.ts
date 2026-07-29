import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { buildIntegrationEvidence, IntegrationEvidence, listIntegrationEvidenceFiles } from "./evidence.js";

const INDEX_PATH = ".contractbot/index/integration-evidence.json";

interface CachedFile { hash: string; evidence: IntegrationEvidence[] }
interface EvidenceIndex { version: 1; files: Record<string, CachedFile> }

export async function buildCachedIntegrationEvidence(projectDir: string, refresh = false): Promise<IntegrationEvidence[]> {
  const path = join(projectDir, INDEX_PATH);
  const prior = !refresh && existsSync(path)
    ? JSON.parse(await readFile(path, "utf-8")) as EvidenceIndex
    : { version: 1 as const, files: {} };
  const files = await listIntegrationEvidenceFiles(projectDir);
  const next: EvidenceIndex = { version: 1, files: {} };
  const changed: string[] = [];

  for (const file of files) {
    const hash = createHash("sha256").update(await readFile(file)).digest("hex");
    if (!refresh && prior.files[file]?.hash === hash) next.files[file] = prior.files[file];
    else {
      next.files[file] = { hash, evidence: [] };
      changed.push(file);
    }
  }
  const extracted = await buildIntegrationEvidence(projectDir, changed);
  for (const file of changed) next.files[file].evidence = extracted.filter((item) => item.file === file);

  await mkdir(join(projectDir, ".contractbot", "index"), { recursive: true });
  await writeFile(path, JSON.stringify(next, null, 2) + "\n", "utf-8");
  return Object.values(next.files).flatMap((file) => file.evidence);
}
