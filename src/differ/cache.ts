import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { OpenApiSpec } from "./types.js";

const CACHE_DIR = ".apihealer/cache";

export interface SpecCacheMeta {
  etag?: string;
  lastModified?: string;
  fetchedAt?: string;
  url?: string;
}

export async function getCachedSpec(
  apiName: string,
): Promise<OpenApiSpec | null> {
  const path = join(CACHE_DIR, `${apiName}.json`);
  if (!existsSync(path)) return null;

  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as OpenApiSpec;
}

export async function getCachedMeta(
  apiName: string,
): Promise<SpecCacheMeta | null> {
  const path = join(CACHE_DIR, `${apiName}.meta.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SpecCacheMeta;
  } catch {
    return null;
  }
}

export async function cacheSpec(
  apiName: string,
  spec: OpenApiSpec,
  meta?: SpecCacheMeta,
): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const path = join(CACHE_DIR, `${apiName}.json`);
  await writeFile(path, JSON.stringify(spec, null, 2), "utf-8");

  if (meta && (meta.etag || meta.lastModified || meta.url)) {
    const metaPath = join(CACHE_DIR, `${apiName}.meta.json`);
    await writeFile(
      metaPath,
      JSON.stringify(
        {
          ...meta,
          fetchedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf-8",
    );
  }
}
