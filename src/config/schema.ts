export interface ApiEntry {
  name: string;
  spec: string;
  scan_paths: string[];
}

export interface AiConfig {
  provider: "openai" | "anthropic" | "ollama";
  model?: string;
  base_url?: string;
}

export interface HealingConfig {
  auto_apply: "none" | "non-breaking" | "all";
  output: "patch" | "pr" | "stdout";
}

export interface ApihealerConfig {
  apis: ApiEntry[];
  ai: AiConfig;
  healing: HealingConfig;
}

export const DEFAULT_CONFIG: ApihealerConfig = {
  apis: [],
  ai: {
    provider: "openai",
    model: "gpt-4o-mini",
  },
  healing: {
    auto_apply: "non-breaking",
    output: "patch",
  },
};
