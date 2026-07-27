import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveApiKey } from "../src/providers/api-key.js";

const KEYS = [
  "CONTRACTBOT_API_KEY",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MOONSHOT_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveApiKey", () => {
  it("uses api_key_env exclusively when set", () => {
    process.env.MOONSHOT_API_KEY = "moon-key";
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.CONTRACTBOT_API_KEY = "healer-key";

    const result = resolveApiKey({
      apiKeyEnv: "MOONSHOT_API_KEY",
      providerFallbacks: ["OPENAI_API_KEY"],
      providerLabel: "openai",
    });

    expect(result).toEqual({ key: "moon-key", envVar: "MOONSHOT_API_KEY" });
  });

  it("errors when api_key_env is set but missing", () => {
    process.env.OPENAI_API_KEY = "openai-key";

    expect(() =>
      resolveApiKey({
        apiKeyEnv: "MOONSHOT_API_KEY",
        providerFallbacks: ["OPENAI_API_KEY"],
        providerLabel: "openai",
      }),
    ).toThrow(/MOONSHOT_API_KEY/);
  });

  it("prefers CONTRACTBOT_API_KEY over provider default", () => {
    process.env.CONTRACTBOT_API_KEY = "healer-key";
    process.env.OPENAI_API_KEY = "openai-key";

    const result = resolveApiKey({
      providerFallbacks: ["OPENAI_API_KEY"],
      providerLabel: "openai",
    });

    expect(result).toEqual({ key: "healer-key", envVar: "CONTRACTBOT_API_KEY" });
  });

  it("falls back to LLM_API_KEY then provider default", () => {
    process.env.LLM_API_KEY = "llm-key";
    process.env.OPENAI_API_KEY = "openai-key";

    expect(
      resolveApiKey({
        providerFallbacks: ["OPENAI_API_KEY"],
        providerLabel: "openai",
      }),
    ).toEqual({ key: "llm-key", envVar: "LLM_API_KEY" });

    delete process.env.LLM_API_KEY;

    expect(
      resolveApiKey({
        providerFallbacks: ["OPENAI_API_KEY"],
        providerLabel: "openai",
      }),
    ).toEqual({ key: "openai-key", envVar: "OPENAI_API_KEY" });
  });

  it("uses ANTHROPIC_API_KEY as anthropic fallback", () => {
    process.env.ANTHROPIC_API_KEY = "ant-key";

    expect(
      resolveApiKey({
        providerFallbacks: ["ANTHROPIC_API_KEY"],
        providerLabel: "anthropic",
      }),
    ).toEqual({ key: "ant-key", envVar: "ANTHROPIC_API_KEY" });
  });

  it("lists candidates when no key is found", () => {
    expect(() =>
      resolveApiKey({
        providerFallbacks: ["OPENAI_API_KEY"],
        providerLabel: "openai",
      }),
    ).toThrow(/CONTRACTBOT_API_KEY.*LLM_API_KEY.*OPENAI_API_KEY/);
  });
});
