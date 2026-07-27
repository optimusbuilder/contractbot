import { LlmProvider, ProviderConfig } from "./types.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";

export function createProvider(config: ProviderConfig): LlmProvider {
  switch (config.provider) {
    case "openai":
      return new OpenAIProvider(config.model, config.base_url);
    case "anthropic":
      return new AnthropicProvider(config.model);
    case "ollama":
      return new OllamaProvider(config.model, config.base_url);
    default:
      throw new Error(`Unknown AI provider: ${config.provider}`);
  }
}

export type { LlmProvider, ProviderConfig } from "./types.js";
