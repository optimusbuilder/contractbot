export type WatchStrategy =
  | "spec_poll"
  | "probe"
  | "changelog"
  | "repo_watch"
  | "sdk_version";

export type ContractType = "openapi" | "sdk_package" | "changelog" | "unresolved";

export interface OpenApiContract {
  type: "openapi";
  url: string;
  resolved_via?: "catalog" | "well_known" | "web_search" | "manual";
}

export interface SdkPackageContract {
  type: "sdk_package";
  ecosystem: "npm" | "pypi" | "go" | "rubygems";
  package: string;
  resolved_via?: "catalog" | "well_known" | "web_search" | "manual";
}

export interface ChangelogContract {
  type: "changelog";
  sources: Array<{
    type: "github_releases" | "rss" | "atom" | "url";
    url: string;
    repo?: string;
  }>;
  resolved_via?: "catalog" | "well_known" | "web_search" | "manual";
}

export interface UnresolvedContract {
  type: "unresolved";
  reason?: string;
}

export type ApiContract =
  | OpenApiContract
  | SdkPackageContract
  | ChangelogContract
  | UnresolvedContract;

export interface ApiEntry {
  name: string;
  /** @deprecated Prefer `contract`. Kept for backward compatibility with older configs. */
  spec?: string;
  contract?: ApiContract;
  hosts?: string[];
  packages?: string[];
  scan_paths: string[];
  languages?: Array<"typescript" | "python" | "go" | "ruby" | "auto">;
  watch?: WatchConfig;
  evidence?: string[];
  needs_resolve?: boolean;
  /**
   * How aggressively to poll this API.
   * critical → every ~15m (default for payments/auth-style catalog APIs)
   * normal → included in frequent watches (default)
   * low → can be skipped with --min-urgency critical|normal
   */
  urgency?: ApiUrgency;
}

export type ApiUrgency = "critical" | "normal" | "low";

export const URGENCY_RANK: Record<ApiUrgency, number> = {
  critical: 3,
  normal: 2,
  low: 1,
};

/** Suggested poll interval in minutes for docs / Action generation. */
export function pollIntervalMinutes(urgency: ApiUrgency = "normal"): number {
  switch (urgency) {
    case "critical":
      return 15;
    case "normal":
      return 15;
    case "low":
      return 60;
  }
}

export function meetsMinUrgency(
  api: ApiEntry,
  minUrgency: ApiUrgency = "low",
): boolean {
  const apiRank = URGENCY_RANK[api.urgency ?? "normal"];
  return apiRank >= URGENCY_RANK[minUrgency];
}

export interface WatchConfig {
  strategies?: WatchStrategy[];
  probe?: {
    base_url: string;
    endpoints?: Array<{
      path: string;
      method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    }>;
    auth?: {
      type: "bearer" | "api_key" | "basic";
      env_var: string;
      header_name?: string;
    };
    rate_limit_ms?: number;
  };
  changelog?: {
    sources: Array<{
      type: "github_releases" | "rss" | "atom" | "url";
      url: string;
      repo?: string;
    }>;
  };
  repo?: {
    github_repo: string;
    spec_path: string;
    branch?: string;
  };
  sdk?: {
    ecosystem: "npm" | "pypi" | "go" | "rubygems";
    package: string;
  };
}

export interface AiConfig {
  provider: "openai" | "anthropic" | "ollama";
  model?: string;
  base_url?: string;
  /**
   * Env var name for the API key (e.g. MOONSHOT_API_KEY, ZHIPU_API_KEY).
   * When unset, tries CONTRACTBOT_API_KEY → LLM_API_KEY → OPENAI_API_KEY / ANTHROPIC_API_KEY.
   */
  api_key_env?: string;
  cache?: boolean;
  budget_usd?: number;
  max_requests?: number;
  requests_per_minute?: number;
}

export interface HealingConfig {
  auto_apply: "none" | "non-breaking" | "all";
  output: "patch" | "pr" | "stdout";
}

export interface ContractbotConfig {
  apis: ApiEntry[];
  ai: AiConfig;
  healing: HealingConfig;
}

export const DEFAULT_CONFIG: ContractbotConfig = {
  apis: [],
  ai: {
    provider: "openai",
    model: "gpt-4o-mini",
  },
  healing: {
    auto_apply: "none",
    output: "pr",
  },
};

/** Resolve the effective OpenAPI URL for an API entry (new contract or legacy spec). */
export function getOpenApiUrl(api: ApiEntry): string | null {
  if (api.contract?.type === "openapi") return api.contract.url;
  if (api.spec) return api.spec;
  return null;
}

/** Whether this API has a watchable contract (not unresolved). */
export function hasResolvedContract(api: ApiEntry): boolean {
  if (api.needs_resolve) return false;
  if (api.contract) return api.contract.type !== "unresolved";
  return Boolean(api.spec);
}

/** Normalize legacy `spec` into `contract` on load. */
export function normalizeApiEntry(api: ApiEntry): ApiEntry {
  if (api.contract) return api;
  if (api.spec) {
    return {
      ...api,
      contract: { type: "openapi", url: api.spec, resolved_via: "manual" },
      needs_resolve: false,
    };
  }
  return {
    ...api,
    contract: { type: "unresolved", reason: "No contract configured" },
    needs_resolve: true,
  };
}
