import { ProbeConfig, ProbeEndpoint, InferredSchema, WatchEvent } from "./types.js";
import { SchemaObject } from "../differ/types.js";

interface ProbeResult {
  endpoint: ProbeEndpoint;
  statusCode: number;
  responseBody: unknown;
  responseHeaders: Record<string, string>;
  latencyMs: number;
  error?: string;
}

/**
 * Probes live endpoints and compares their actual response shapes
 * against what the cached OpenAPI spec says they should return.
 */
export async function probeEndpoints(
  config: ProbeConfig,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  const delay = config.rateLimit ?? 200;

  for (const endpoint of config.endpoints) {
    const result = await probeSingle(endpoint, config);
    results.push(result);

    if (delay > 0 && config.endpoints.indexOf(endpoint) < config.endpoints.length - 1) {
      await sleep(delay);
    }
  }

  return results;
}

/**
 * Compares probe results against an expected schema from the cached spec
 * and returns watch events for any discrepancies found.
 */
export function diffProbeResults(
  apiName: string,
  results: ProbeResult[],
  expectedSchemas: Map<string, SchemaObject>,
): WatchEvent[] {
  const events: WatchEvent[] = [];

  for (const result of results) {
    if (result.error) continue;

    const key = `${result.endpoint.method}:${result.endpoint.path}`;
    const expected = expectedSchemas.get(key);

    if (!expected) continue;

    const inferred = inferSchema(result.responseBody);
    const diffs = compareSchemas(expected, inferred, "");

    for (const diff of diffs) {
      events.push({
        apiName,
        strategy: "probe",
        timestamp: new Date(),
        description: `${result.endpoint.method} ${result.endpoint.path}: ${diff.message}`,
        severity: diff.breaking ? "breaking" : "unknown",
        details: {
          endpoint: key,
          field: diff.path,
          expected: diff.expected,
          actual: diff.actual,
        },
      });
    }
  }

  return events;
}

/**
 * Infers a schema from a live response body value.
 */
export function inferSchema(value: unknown): InferredSchema {
  if (value === null || value === undefined) {
    return { type: "null", nullable: true };
  }

  if (Array.isArray(value)) {
    const items = value.length > 0
      ? inferSchema(value[0])
      : { type: "unknown" };
    return { type: "array", items };
  }

  if (typeof value === "object") {
    const properties: Record<string, InferredSchema> = {};
    const required: string[] = [];

    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      properties[key] = inferSchema(val);
      if (val !== null && val !== undefined) {
        required.push(key);
      }
    }

    return { type: "object", properties, required };
  }

  if (typeof value === "number") {
    return { type: Number.isInteger(value) ? "integer" : "number" };
  }

  if (typeof value === "boolean") {
    return { type: "boolean" };
  }

  return { type: "string" };
}

interface SchemaDiff {
  path: string;
  message: string;
  breaking: boolean;
  expected: string;
  actual: string;
}

function compareSchemas(
  expected: SchemaObject,
  actual: InferredSchema,
  path: string,
): SchemaDiff[] {
  const diffs: SchemaDiff[] = [];

  if (expected.type && actual.type && !typesCompatible(expected.type, actual.type)) {
    diffs.push({
      path: path || "(root)",
      message: `Type changed: expected "${expected.type}", got "${actual.type}"`,
      breaking: true,
      expected: expected.type,
      actual: actual.type,
    });
    return diffs;
  }

  if (expected.type === "object" && actual.type === "object") {
    const expectedProps = expected.properties ?? {};
    const actualProps = actual.properties ?? {};

    for (const propName of Object.keys(expectedProps)) {
      const fieldPath = path ? `${path}.${propName}` : propName;

      if (!actualProps[propName]) {
        diffs.push({
          path: fieldPath,
          message: `Field "${fieldPath}" no longer present in response`,
          breaking: true,
          expected: "present",
          actual: "missing",
        });
      } else {
        const nested = compareSchemas(
          expectedProps[propName],
          actualProps[propName],
          fieldPath,
        );
        diffs.push(...nested);
      }
    }

    for (const propName of Object.keys(actualProps)) {
      if (!expectedProps[propName]) {
        const fieldPath = path ? `${path}.${propName}` : propName;
        diffs.push({
          path: fieldPath,
          message: `New field "${fieldPath}" appeared in response`,
          breaking: false,
          expected: "absent",
          actual: actualProps[propName].type,
        });
      }
    }
  }

  if (expected.type === "array" && actual.type === "array") {
    if (expected.items && actual.items) {
      const nested = compareSchemas(expected.items, actual.items, `${path}[]`);
      diffs.push(...nested);
    }
  }

  return diffs;
}

function typesCompatible(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (expected === "number" && actual === "integer") return true;
  if (expected === "integer" && actual === "number") return true;
  return false;
}

async function probeSingle(
  endpoint: ProbeEndpoint,
  config: ProbeConfig,
): Promise<ProbeResult> {
  let url = `${endpoint.baseUrl || config.baseUrl}${endpoint.path}`;

  if (endpoint.pathParams) {
    for (const [param, value] of Object.entries(endpoint.pathParams)) {
      url = url.replace(`{${param}}`, value);
    }
  }

  const headers: Record<string, string> = {
    "Accept": "application/json",
    ...config.headers,
    ...endpoint.headers,
  };

  if (config.auth) {
    const token = process.env[config.auth.envVar];
    if (token) {
      if (config.auth.type === "bearer") {
        headers["Authorization"] = `Bearer ${token}`;
      } else if (config.auth.type === "api_key") {
        headers[config.auth.headerName ?? "X-API-Key"] = token;
      } else if (config.auth.type === "basic") {
        headers["Authorization"] = `Basic ${Buffer.from(token).toString("base64")}`;
      }
    }
  }

  const start = Date.now();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.timeout ?? 10000,
    );

    const response = await fetch(url, {
      method: endpoint.method,
      headers,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let responseBody: unknown = null;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("json")) {
      responseBody = await response.json();
    }

    return {
      endpoint,
      statusCode: response.status,
      responseBody,
      responseHeaders,
      latencyMs,
    };
  } catch (err) {
    return {
      endpoint,
      statusCode: 0,
      responseBody: null,
      responseHeaders: {},
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
