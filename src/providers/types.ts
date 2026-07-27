export interface LlmProvider {
  generate(prompt: string, systemPrompt?: string): Promise<string>;
}

export interface ProviderConfig {
  provider: "openai" | "anthropic" | "ollama";
  model?: string;
  base_url?: string;
}
