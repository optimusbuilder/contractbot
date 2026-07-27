import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { WatchEvent } from "./types.js";

const SDK_CACHE_DIR = ".apihealer/cache/sdk";

export interface SdkWatchConfig {
  ecosystem: "npm" | "pypi" | "go" | "rubygems";
  package: string;
}

interface SdkCacheEntry {
  version: string;
  checkedAt: string;
  package: string;
  ecosystem: string;
}

/**
 * Watches an SDK package registry for version bumps.
 * First run baselines the current version; later runs emit events on change.
 */
export async function checkSdkVersion(
  apiName: string,
  config: SdkWatchConfig,
): Promise<WatchEvent[]> {
  const latest = await fetchLatestVersion(config);
  if (!latest) return [];

  const cache = await loadSdkCache(apiName);
  if (!cache) {
    await saveSdkCache(apiName, {
      version: latest.version,
      checkedAt: new Date().toISOString(),
      package: config.package,
      ecosystem: config.ecosystem,
    });
    return [];
  }

  if (cache.version === latest.version) return [];

  await saveSdkCache(apiName, {
    version: latest.version,
    checkedAt: new Date().toISOString(),
    package: config.package,
    ecosystem: config.ecosystem,
  });

  const severity = isMajorBump(cache.version, latest.version)
    ? "breaking"
    : "non-breaking";

  return [
    {
      apiName,
      strategy: "sdk_version",
      timestamp: new Date(),
      severity,
      description: `SDK ${config.package} updated: ${cache.version} → ${latest.version}`,
      details: {
        package: config.package,
        ecosystem: config.ecosystem,
        oldVersion: cache.version,
        newVersion: latest.version,
        releaseUrl: latest.releaseUrl,
      },
    },
  ];
}

async function fetchLatestVersion(
  config: SdkWatchConfig,
): Promise<{ version: string; releaseUrl?: string } | null> {
  switch (config.ecosystem) {
    case "npm":
      return fetchNpmVersion(config.package);
    case "pypi":
      return fetchPypiVersion(config.package);
    default:
      return null;
  }
}

async function fetchNpmVersion(
  packageName: string,
): Promise<{ version: string; releaseUrl?: string } | null> {
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    if (!data.version) return null;
    return {
      version: data.version,
      releaseUrl: `https://www.npmjs.com/package/${packageName}?activeTab=versions`,
    };
  } catch {
    return null;
  }
}

async function fetchPypiVersion(
  packageName: string,
): Promise<{ version: string; releaseUrl?: string } | null> {
  try {
    const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`);
    if (!res.ok) return null;
    const data = (await res.json()) as { info?: { version?: string } };
    if (!data.info?.version) return null;
    return {
      version: data.info.version,
      releaseUrl: `https://pypi.org/project/${packageName}/`,
    };
  } catch {
    return null;
  }
}

function isMajorBump(oldV: string, newV: string): boolean {
  const o = oldV.replace(/^v/, "").split(".")[0];
  const n = newV.replace(/^v/, "").split(".")[0];
  const oi = parseInt(o, 10);
  const ni = parseInt(n, 10);
  if (Number.isNaN(oi) || Number.isNaN(ni)) return true;
  return ni > oi;
}

async function loadSdkCache(apiName: string): Promise<SdkCacheEntry | null> {
  const path = join(SDK_CACHE_DIR, `${apiName}.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SdkCacheEntry;
  } catch {
    return null;
  }
}

async function saveSdkCache(apiName: string, entry: SdkCacheEntry): Promise<void> {
  await mkdir(SDK_CACHE_DIR, { recursive: true });
  await writeFile(
    join(SDK_CACHE_DIR, `${apiName}.json`),
    JSON.stringify(entry, null, 2),
    "utf-8",
  );
}
