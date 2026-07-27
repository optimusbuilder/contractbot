export type WatchStrategy =
  | "spec_poll"
  | "probe"
  | "changelog"
  | "repo_watch"
  | "sdk_version";

export interface WatchEvent {
  apiName: string;
  strategy: WatchStrategy;
  timestamp: Date;
  description: string;
  severity: "breaking" | "non-breaking" | "unknown";
  details?: Record<string, unknown>;
}

export interface ProbeEndpoint {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  baseUrl: string;
  headers?: Record<string, string>;
  body?: unknown;
  pathParams?: Record<string, string>;
}

export interface ProbeConfig {
  baseUrl: string;
  endpoints: ProbeEndpoint[];
  headers?: Record<string, string>;
  auth?: {
    type: "bearer" | "api_key" | "basic";
    envVar: string;
    headerName?: string;
  };
  timeout?: number;
  rateLimit?: number;
}

export interface ChangelogSource {
  type: "github_releases" | "rss" | "atom" | "url";
  url: string;
  repo?: string;
}

export interface RepoWatchConfig {
  repo: string;
  specPath: string;
  branch?: string;
}

export interface InferredSchema {
  type: string;
  properties?: Record<string, InferredSchema>;
  items?: InferredSchema;
  nullable?: boolean;
  enum?: unknown[];
  required?: string[];
}

export interface InferredEndpoint {
  path: string;
  method: string;
  statusCode: number;
  responseSchema: InferredSchema;
  observedAt: string;
  sampleCount: number;
}
