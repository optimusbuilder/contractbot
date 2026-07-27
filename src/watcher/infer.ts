import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { InferredSchema, InferredEndpoint, WatchEvent } from "./types.js";
import { inferSchema } from "./probe.js";

const INFER_CACHE_DIR = ".contractbot/cache/inferred";

interface InferredSpecCache {
  apiName: string;
  lastUpdated: string;
  endpoints: InferredEndpoint[];
}

/**
 * Records a live response and builds/updates an inferred schema for
 * APIs that don't publish an OpenAPI spec.
 *
 * Over time this builds a "learned" spec from actual traffic, then
 * diffs new observations against the learned baseline.
 */
export async function recordObservation(
  apiName: string,
  path: string,
  method: string,
  statusCode: number,
  responseBody: unknown,
): Promise<WatchEvent[]> {
  const cache = await loadInferredCache(apiName);
  const newSchema = inferSchema(responseBody);
  const key = `${method}:${path}:${statusCode}`;

  const existing = cache.endpoints.find(
    (e) => `${e.method}:${e.path}:${e.statusCode}` === key,
  );

  const events: WatchEvent[] = [];

  if (existing) {
    const diffs = diffInferredSchemas(existing.responseSchema, newSchema, "");

    for (const diff of diffs) {
      events.push({
        apiName,
        strategy: "probe",
        timestamp: new Date(),
        description: `${method} ${path} (${statusCode}): ${diff.message}`,
        severity: diff.breaking ? "breaking" : "unknown",
        details: {
          field: diff.path,
          expected: diff.expected,
          actual: diff.actual,
        },
      });
    }

    existing.responseSchema = mergeSchemas(existing.responseSchema, newSchema);
    existing.observedAt = new Date().toISOString();
    existing.sampleCount += 1;
  } else {
    cache.endpoints.push({
      path,
      method,
      statusCode,
      responseSchema: newSchema,
      observedAt: new Date().toISOString(),
      sampleCount: 1,
    });
  }

  cache.lastUpdated = new Date().toISOString();
  await saveInferredCache(apiName, cache);

  return events;
}

/**
 * Returns the current inferred spec for an API, built from
 * accumulated observations.
 */
export async function getInferredSpec(
  apiName: string,
): Promise<InferredEndpoint[]> {
  const cache = await loadInferredCache(apiName);
  return cache.endpoints;
}

/**
 * Compares the current inferred spec against a new full observation pass
 * and returns any detected changes.
 */
export async function diffAgainstInferred(
  apiName: string,
  observations: Array<{
    path: string;
    method: string;
    statusCode: number;
    responseBody: unknown;
  }>,
): Promise<WatchEvent[]> {
  const events: WatchEvent[] = [];

  for (const obs of observations) {
    const obsEvents = await recordObservation(
      apiName,
      obs.path,
      obs.method,
      obs.statusCode,
      obs.responseBody,
    );
    events.push(...obsEvents);
  }

  return events;
}

interface InferredDiff {
  path: string;
  message: string;
  breaking: boolean;
  expected: string;
  actual: string;
}

function diffInferredSchemas(
  baseline: InferredSchema,
  current: InferredSchema,
  path: string,
): InferredDiff[] {
  const diffs: InferredDiff[] = [];

  if (baseline.type !== current.type) {
    if (!baseline.nullable || current.type !== "null") {
      diffs.push({
        path: path || "(root)",
        message: `Type changed: "${baseline.type}" → "${current.type}"`,
        breaking: true,
        expected: baseline.type,
        actual: current.type,
      });
    }
    return diffs;
  }

  if (baseline.type === "object" && current.type === "object") {
    const baseProps = baseline.properties ?? {};
    const currProps = current.properties ?? {};

    for (const propName of Object.keys(baseProps)) {
      const fieldPath = path ? `${path}.${propName}` : propName;

      if (!currProps[propName]) {
        diffs.push({
          path: fieldPath,
          message: `Field disappeared: "${fieldPath}"`,
          breaking: true,
          expected: "present",
          actual: "missing",
        });
      } else {
        const nested = diffInferredSchemas(
          baseProps[propName],
          currProps[propName],
          fieldPath,
        );
        diffs.push(...nested);
      }
    }

    for (const propName of Object.keys(currProps)) {
      if (!baseProps[propName]) {
        const fieldPath = path ? `${path}.${propName}` : propName;
        diffs.push({
          path: fieldPath,
          message: `New field appeared: "${fieldPath}"`,
          breaking: false,
          expected: "absent",
          actual: currProps[propName].type,
        });
      }
    }
  }

  if (baseline.type === "array" && current.type === "array") {
    if (baseline.items && current.items) {
      const nested = diffInferredSchemas(
        baseline.items,
        current.items,
        `${path}[]`,
      );
      diffs.push(...nested);
    }
  }

  return diffs;
}

/**
 * Merges a new observation into an existing schema, widening types
 * where needed (e.g. a field that was "string" and is now sometimes
 * "null" becomes nullable).
 */
function mergeSchemas(
  existing: InferredSchema,
  observed: InferredSchema,
): InferredSchema {
  if (existing.type !== observed.type) {
    return {
      ...existing,
      nullable: existing.nullable || observed.type === "null",
    };
  }

  if (existing.type === "object" && observed.type === "object") {
    const merged: InferredSchema = {
      type: "object",
      properties: { ...existing.properties },
      required: [],
    };

    const existingProps = existing.properties ?? {};
    const observedProps = observed.properties ?? {};

    for (const [key, val] of Object.entries(observedProps)) {
      if (existingProps[key]) {
        merged.properties![key] = mergeSchemas(existingProps[key], val);
      } else {
        merged.properties![key] = val;
      }
    }

    const existingRequired = new Set(existing.required ?? []);
    const observedRequired = new Set(observed.required ?? []);
    merged.required = [...existingRequired].filter((r) =>
      observedRequired.has(r),
    );

    return merged;
  }

  if (existing.type === "array" && observed.type === "array") {
    return {
      type: "array",
      items:
        existing.items && observed.items
          ? mergeSchemas(existing.items, observed.items)
          : existing.items ?? observed.items,
    };
  }

  return existing;
}

async function loadInferredCache(apiName: string): Promise<InferredSpecCache> {
  const path = join(INFER_CACHE_DIR, `${apiName}.json`);
  if (!existsSync(path)) {
    return { apiName, lastUpdated: new Date().toISOString(), endpoints: [] };
  }

  const raw = await readFile(path, "utf-8");
  return JSON.parse(raw) as InferredSpecCache;
}

async function saveInferredCache(
  apiName: string,
  cache: InferredSpecCache,
): Promise<void> {
  await mkdir(INFER_CACHE_DIR, { recursive: true });
  const path = join(INFER_CACHE_DIR, `${apiName}.json`);
  await writeFile(path, JSON.stringify(cache, null, 2), "utf-8");
}
