import { LlmProvider, ProviderConfig } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { TrackedProvider, TrackedProviderOptions } from "./tracked-provider.js";

export interface CreateProviderOptions extends ProviderConfig {
  cache?: boolean;
  budget_usd?: number;
  max_requests?: number;
  requests_per_minute?: number;
}

export function createProvider(config: CreateProviderOptions): LlmProvider {
  let inner: LlmProvider;
  const model = config.model ?? getDefaultModel(config.provider);

  switch (config.provider) {
    case "openai":
      inner = new OpenAIProvider(config.model, config.base_url);
      break;
    case "anthropic":
      inner = new AnthropicProvider(config.model);
      break;
    case "ollama":
      inner = new OllamaProvider(config.model, config.base_url);
      break;
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }

  const trackedOptions: TrackedProviderOptions = {
    cache: { enabled: config.cache !== false },
    budgetUsd: config.budget_usd,
    maxRequests: config.max_requests,
    rateLimiter: config.requests_per_minute
      ? { requestsPerMinute: config.requests_per_minute }
      : undefined,
  };

  return new TrackedProvider(inner, model, trackedOptions);
}

function getDefaultModel(provider: string): string {
  switch (provider) {
    case "openai": return "gpt-4o-mini";
    case "anthropic": return "claude-sonnet-4-20250514";
    case "ollama": return "llama3.1";
    default: return "unknown";
  }
}

export type { LlmProvider, ProviderConfig } from "./types.js";
export { TrackedProvider } from "./tracked-provider.js";
export type { TrackedProviderOptions } from "./tracked-provider.js";
export { AiCache } from "./cache.js";
export type { AiCacheOptions } from "./cache.js";
export { UsageTracker } from "./usage.js";
export type { UsageRecord, UsageSummary } from "./usage.js";
export { RateLimiter } from "./rate-limiter.js";
export type { RateLimiterOptions } from "./rate-limiter.js";
