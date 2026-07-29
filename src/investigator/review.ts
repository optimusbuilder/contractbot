import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const REVIEW_PATH = ".contractbot/reviews/discovery.json";

export async function saveDiscoveryReview(dir: string, candidates: unknown[]): Promise<string> {
  const path = join(dir, REVIEW_PATH);
  await mkdir(join(dir, ".contractbot", "reviews"), { recursive: true });
  await writeFile(path, JSON.stringify({ createdAt: new Date().toISOString(), candidates }, null, 2) + "\n", "utf-8");
  return path;
}

export async function loadDiscoveryReview(dir: string): Promise<unknown | null> {
  const path = join(dir, REVIEW_PATH);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8"));
}
