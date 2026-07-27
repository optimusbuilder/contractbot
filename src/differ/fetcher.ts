import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { OpenApiSpec } from "./types.js";
import { getCachedMeta, SpecCacheMeta } from "./cache.js";

export interface FetchSpecResult {
  spec: OpenApiSpec;
  /** True when the remote returned 304 Not Modified (ETag / Last-Modified match). */
  notModified: boolean;
  etag?: string;
  lastModified?: string;
}

/**
 * Fetch an OpenAPI spec from a URL or local path.
 * When `apiName` is provided for HTTP URLs, sends If-None-Match / If-Modified-Since
 * so unchanged specs return quickly with `notModified: true`.
 */
export async function fetchSpec(
  specUrl: string,
  options: { apiName?: string } = {},
): Promise<FetchSpecResult> {
  if (specUrl.startsWith("http://") || specUrl.startsWith("https://")) {
    return fetchRemoteSpec(specUrl, options.apiName);
  }

  if (!existsSync(specUrl)) {
    throw new Error(`Spec file not found: ${specUrl}`);
  }

  const content = await readFile(specUrl, "utf-8");

  if (specUrl.endsWith(".yaml") || specUrl.endsWith(".yml")) {
    const { parse } = await import("yaml");
    return {
      spec: parse(content) as OpenApiSpec,
      notModified: false,
    };
  }

  return {
    spec: JSON.parse(content) as OpenApiSpec,
    notModified: false,
  };
}

async function fetchRemoteSpec(
  specUrl: string,
  apiName?: string,
): Promise<FetchSpecResult> {
  const headers: Record<string, string> = {
    Accept: "application/json, application/yaml, text/yaml, */*",
  };

  let meta: SpecCacheMeta | null = null;
  if (apiName) {
    meta = await getCachedMeta(apiName);
    if (meta?.etag) headers["If-None-Match"] = meta.etag;
    if (meta?.lastModified) headers["If-Modified-Since"] = meta.lastModified;
  }

  const response = await fetch(specUrl, { headers });

  if (response.status === 304) {
    if (!apiName) {
      throw new Error(`Received 304 for ${specUrl} but no apiName/cache available`);
    }
    const { getCachedSpec } = await import("./cache.js");
    const cached = await getCachedSpec(apiName);
    if (!cached) {
      // Stale meta without body — refetch unconditionally
      return fetchRemoteSpecUnconditional(specUrl);
    }
    return {
      spec: cached,
      notModified: true,
      etag: meta?.etag,
      lastModified: meta?.lastModified,
    };
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch spec from ${specUrl}: ${response.status} ${response.statusText}`,
    );
  }

  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  let spec: OpenApiSpec;
  if (
    contentType.includes("yaml") ||
    specUrl.endsWith(".yaml") ||
    specUrl.endsWith(".yml") ||
    text.trimStart().startsWith("openapi:") ||
    text.trimStart().startsWith("swagger:")
  ) {
    const { parse } = await import("yaml");
    spec = parse(text) as OpenApiSpec;
  } else {
    spec = JSON.parse(text) as OpenApiSpec;
  }

  return { spec, notModified: false, etag, lastModified };
}

async function fetchRemoteSpecUnconditional(specUrl: string): Promise<FetchSpecResult> {
  const response = await fetch(specUrl, {
    headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch spec from ${specUrl}: ${response.status} ${response.statusText}`,
    );
  }
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  const text = await response.text();
  let spec: OpenApiSpec;
  if (
    specUrl.endsWith(".yaml") ||
    specUrl.endsWith(".yml") ||
    text.trimStart().startsWith("openapi:")
  ) {
    const { parse } = await import("yaml");
    spec = parse(text) as OpenApiSpec;
  } else {
    spec = JSON.parse(text) as OpenApiSpec;
  }
  return { spec, notModified: false, etag, lastModified };
}
