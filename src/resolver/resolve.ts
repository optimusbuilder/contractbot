import { ApiEntry, ApiContract, WatchStrategy } from "../config/schema.js";
import { findCatalogByName, findCatalogByHost, findCatalogByPackage } from "../detector/registry.js";

const WELL_KNOWN_PATHS = [
  "/openapi.json",
  "/openapi.yaml",
  "/openapi.yml",
  "/swagger.json",
  "/swagger.yaml",
  "/api/openapi.json",
  "/api/swagger.json",
  "/v1/openapi.json",
  "/.well-known/openapi.json",
  "/docs/openapi.json",
];

export interface ResolveOptions {
  webSearch?: boolean;
  timeoutMs?: number;
}

export interface ResolveResult {
  api: ApiEntry;
  resolved: boolean;
  method?: string;
  message: string;
}

/**
 * Resolve an unresolved API entry to a watchable contract.
 * Order: catalog → well-known OpenAPI paths → SDK package → optional web search.
 */
export async function resolveApiContract(
  api: ApiEntry,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  if (api.contract && api.contract.type !== "unresolved" && !api.needs_resolve) {
    return {
      api,
      resolved: true,
      method: "already_resolved",
      message: `${api.name}: already has a ${api.contract.type} contract`,
    };
  }

  // 1. Catalog match by name / host / package
  const fromCatalog = resolveFromCatalog(api);
  if (fromCatalog) {
    return {
      api: fromCatalog,
      resolved: true,
      method: "catalog",
      message: `${api.name}: resolved via catalog (${fromCatalog.contract?.type})`,
    };
  }

  // 2. Well-known OpenAPI paths on hosts
  const fromWellKnown = await resolveFromWellKnown(api, options.timeoutMs ?? 5000);
  if (fromWellKnown) {
    return {
      api: fromWellKnown,
      resolved: true,
      method: "well_known",
      message: `${api.name}: found OpenAPI at well-known path`,
    };
  }

  // 3. SDK package already listed on the entry
  if (api.packages && api.packages.length > 0) {
    const pkg = api.packages[0];
    const catalogPkg = findCatalogByPackage(pkg);
    if (catalogPkg?.contract) {
      const updated = applyContract(api, catalogPkg.contract, catalogPkg.defaultWatch);
      return {
        api: updated,
        resolved: true,
        method: "sdk_package",
        message: `${api.name}: resolved via package ${pkg}`,
      };
    }
    // Treat first npm-looking package as SDK proxy
    const updated = applyContract(
      api,
      {
        type: "sdk_package",
        ecosystem: "npm",
        package: pkg,
        resolved_via: "manual",
      },
      ["sdk_version"],
    );
    return {
      api: updated,
      resolved: true,
      method: "sdk_package",
      message: `${api.name}: using SDK package ${pkg} as contract proxy`,
    };
  }

  // 4. Optional web search bootstrap
  if (options.webSearch) {
    const fromSearch = await resolveFromWebSearch(api);
    if (fromSearch) {
      return {
        api: fromSearch,
        resolved: true,
        method: "web_search",
        message: `${api.name}: resolved via web search`,
      };
    }
  }

  const unresolved: ApiEntry = {
    ...api,
    contract: {
      type: "unresolved",
      reason: options.webSearch
        ? "Could not find OpenAPI, SDK, or search result"
        : "Could not find OpenAPI or SDK — try: contractbot resolve --web-search",
    },
    needs_resolve: true,
  };

  return {
    api: unresolved,
    resolved: false,
    message: `${api.name}: still unresolved`,
  };
}

function resolveFromCatalog(api: ApiEntry): ApiEntry | null {
  const byName = findCatalogByName(api.name);
  if (byName?.contract) {
    return applyContract(api, byName.contract, byName.defaultWatch, byName.changelogRepo);
  }

  for (const host of api.hosts ?? []) {
    const byHost = findCatalogByHost(host);
    if (byHost?.contract) {
      return applyContract(api, byHost.contract, byHost.defaultWatch, byHost.changelogRepo);
    }
  }

  for (const pkg of api.packages ?? []) {
    const byPkg = findCatalogByPackage(pkg);
    if (byPkg?.contract) {
      return applyContract(api, byPkg.contract, byPkg.defaultWatch, byPkg.changelogRepo);
    }
  }

  return null;
}

async function resolveFromWellKnown(
  api: ApiEntry,
  timeoutMs: number,
): Promise<ApiEntry | null> {
  const hosts = api.hosts ?? [];
  for (const host of hosts) {
    let origin: string;
    try {
      origin = new URL(host).origin;
    } catch {
      continue;
    }

    for (const path of WELL_KNOWN_PATHS) {
      const url = `${origin}${path}`;
      if (await looksLikeOpenApi(url, timeoutMs)) {
        return applyContract(
          api,
          { type: "openapi", url, resolved_via: "well_known" },
          ["spec_poll"],
        );
      }
    }
  }
  return null;
}

async function looksLikeOpenApi(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = await res.text();
    const lower = text.slice(0, 500).toLowerCase();
    return (
      lower.includes("openapi") ||
      lower.includes("swagger") ||
      (lower.includes("paths") && lower.includes("info"))
    );
  } catch {
    return false;
  }
}

/**
 * Lightweight bootstrap search: DuckDuckGo HTML (no API key).
 * Looks for OpenAPI/swagger links related to the API host/name.
 */
export async function resolveFromWebSearch(api: ApiEntry): Promise<ApiEntry | null> {
  const host = api.hosts?.[0];
  const queryParts = [
    api.name,
    host ? new URL(host.startsWith("http") ? host : `https://${host}`).hostname : "",
    "OpenAPI OR swagger OR openapi.json",
  ].filter(Boolean);
  const query = queryParts.join(" ");

  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "contractbot/0.1 (bootstrap contract resolver)",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const linkRegex = /href="(https?:\/\/[^"]+\.(?:json|yaml|yml))"/gi;
    const candidates: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      if (
        /openapi|swagger|oai|api-spec|api_spec/i.test(url) ||
        url.endsWith(".json") ||
        url.endsWith(".yaml")
      ) {
        candidates.push(url);
      }
    }

    // Also catch uddg redirect links
    const uddgRegex = /uddg=([^&"]+)/gi;
    while ((match = uddgRegex.exec(html)) !== null) {
      const decoded = decodeURIComponent(match[1]);
      if (/^https?:\/\//.test(decoded) && /openapi|swagger|\.json|\.ya?ml/i.test(decoded)) {
        candidates.push(decoded);
      }
    }

    for (const url of [...new Set(candidates)].slice(0, 8)) {
      if (await looksLikeOpenApi(url, 5000)) {
        return applyContract(
          api,
          { type: "openapi", url, resolved_via: "web_search" },
          ["spec_poll"],
        );
      }
    }
  } catch {
    return null;
  }

  return null;
}

function applyContract(
  api: ApiEntry,
  contract: ApiContract,
  strategies?: WatchStrategy[],
  changelogRepo?: string,
): ApiEntry {
  const entry: ApiEntry = {
    ...api,
    contract,
    needs_resolve: false,
    watch: {
      ...api.watch,
      strategies: strategies ?? api.watch?.strategies ?? ["spec_poll"],
    },
  };

  if (contract.type === "openapi") {
    entry.spec = contract.url;
  }

  if (contract.type === "sdk_package") {
    entry.watch = {
      ...entry.watch,
      sdk: {
        ecosystem: contract.ecosystem,
        package: contract.package,
      },
      strategies: strategies ?? ["sdk_version"],
    };
    if (changelogRepo) {
      entry.watch.changelog = {
        sources: [
          {
            type: "github_releases",
            url: `https://github.com/${changelogRepo}/releases`,
            repo: changelogRepo,
          },
        ],
      };
    }
  }

  return entry;
}
