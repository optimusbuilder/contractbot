export interface LlmProvider {
  generate(prompt: string, systemPrompt?: string): Promise<string>;
}

export interface ProviderConfig {
  provider: "openai" | "anthropic" | "ollama";
  model?: string;
  base_url?: string;
  /** Env var name holding the API key (e.g. MOONSHOT_API_KEY). */
  api_key_env?: string;
}
