/**
 * Resolve an LLM API key from the environment.
 *
 * When `apiKeyEnv` is set (from `ai.api_key_env`), only that variable is used.
 * Otherwise try, in order: CONTRACTBOT_API_KEY → LLM_API_KEY → provider defaults
 * (e.g. OPENAI_API_KEY / ANTHROPIC_API_KEY).
 */
export function resolveApiKey(options: {
  apiKeyEnv?: string;
  providerFallbacks: string[];
  providerLabel: string;
}): { key: string; envVar: string } {
  if (options.apiKeyEnv) {
    const value = process.env[options.apiKeyEnv];
    if (!value) {
      throw new Error(
        `${options.apiKeyEnv} environment variable is required ` +
          `(configured via ai.api_key_env for ${options.providerLabel})`,
      );
    }
    return { key: value, envVar: options.apiKeyEnv };
  }

  const candidates = unique([
    "CONTRACTBOT_API_KEY",
    "LLM_API_KEY",
    ...options.providerFallbacks,
  ]);

  for (const name of candidates) {
    const value = process.env[name];
    if (value) return { key: value, envVar: name };
  }

  throw new Error(
    `No API key found for ${options.providerLabel}. Set one of: ${candidates.join(", ")} ` +
      `(or ai.api_key_env in .contractbot.yml for a custom variable name)`,
  );
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
