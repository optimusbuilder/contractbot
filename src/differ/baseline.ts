import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { DiffResult, OpenApiSpec } from "./types.js";
import { SpecCacheMeta } from "./cache.js";
import type { VerificationResult } from "../verification.js";

const BASELINE_DIR = ".contractbot/baselines";
const CHANGESET_DIR = ".contractbot/changes";

export interface OpenApiBaseline {
  apiName: string;
  sourceUrl: string;
  acceptedAt: string;
  spec: OpenApiSpec;
  meta?: SpecCacheMeta;
}

export interface OpenApiChangeSet {
  apiName: string;
  sourceUrl: string;
  detectedAt: string;
  baseline: OpenApiBaseline;
  nextSpec: OpenApiSpec;
  nextMeta?: SpecCacheMeta;
  diff: DiffResult;
  verification?: VerificationResult;
}

function baselinePath(apiName: string): string {
  return join(BASELINE_DIR, `${apiName}.json`);
}

function changeSetPath(apiName: string): string {
  return join(CHANGESET_DIR, `${apiName}.json`);
}

export async function getBaseline(apiName: string): Promise<OpenApiBaseline | null> {
  const path = baselinePath(apiName);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8")) as OpenApiBaseline;
}

export async function saveBaseline(
  apiName: string,
  sourceUrl: string,
  spec: OpenApiSpec,
  meta?: SpecCacheMeta,
): Promise<OpenApiBaseline> {
  const baseline: OpenApiBaseline = {
    apiName,
    sourceUrl,
    acceptedAt: new Date().toISOString(),
    spec,
    meta,
  };
  await mkdir(BASELINE_DIR, { recursive: true });
  await writeFile(baselinePath(apiName), JSON.stringify(baseline, null, 2) + "\n", "utf-8");
  return baseline;
}

export async function saveChangeSet(changeSet: OpenApiChangeSet): Promise<void> {
  await mkdir(CHANGESET_DIR, { recursive: true });
  await writeFile(
    changeSetPath(changeSet.apiName),
    JSON.stringify(changeSet, null, 2) + "\n",
    "utf-8",
  );
}

export async function getChangeSet(apiName: string): Promise<OpenApiChangeSet | null> {
  const path = changeSetPath(apiName);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf-8")) as OpenApiChangeSet;
}

export async function clearChangeSet(apiName: string): Promise<void> {
  const path = changeSetPath(apiName);
  if (existsSync(path)) {
    const { unlink } = await import("fs/promises");
    await unlink(path);
  }
}
