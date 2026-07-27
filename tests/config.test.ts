import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, saveConfig } from "../src/config/loader.js";
import { DEFAULT_CONFIG } from "../src/config/schema.js";
import { writeFile, mkdir, rm } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(process.cwd(), ".test-config-tmp");
const CONFIG_PATH = join(TEST_DIR, ".apihealer.yml");

beforeEach(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterEach(async () => {
  if (existsSync(TEST_DIR)) {
    await rm(TEST_DIR, { recursive: true });
  }
});

describe("loadConfig", () => {
  it("throws when config file does not exist", async () => {
    await expect(loadConfig("/nonexistent/.apihealer.yml")).rejects.toThrow(
      "Config file not found",
    );
  });

  it("suggests running init in error message", async () => {
    await expect(loadConfig("/nonexistent/.apihealer.yml")).rejects.toThrow(
      "apihealer init",
    );
  });

  it("loads a valid YAML config", async () => {
    const yaml = `
apis:
  - name: payments
    spec: https://example.com/spec.json
    scan_paths:
      - "src/**/*.ts"
ai:
  provider: anthropic
  model: claude-sonnet-4-20250514
healing:
  auto_apply: none
  output: pr
`;
    await writeFile(CONFIG_PATH, yaml, "utf-8");
    const config = await loadConfig(CONFIG_PATH);

    expect(config.apis).toHaveLength(1);
    expect(config.apis[0].name).toBe("payments");
    expect(config.ai.provider).toBe("anthropic");
    expect(config.ai.model).toBe("claude-sonnet-4-20250514");
    expect(config.healing.auto_apply).toBe("none");
    expect(config.healing.output).toBe("pr");
  });

  it("merges partial config with defaults", async () => {
    const yaml = `
apis:
  - name: test
    spec: ./spec.json
    scan_paths: ["src/**"]
`;
    await writeFile(CONFIG_PATH, yaml, "utf-8");
    const config = await loadConfig(CONFIG_PATH);

    expect(config.ai.provider).toBe(DEFAULT_CONFIG.ai.provider);
    expect(config.ai.model).toBe(DEFAULT_CONFIG.ai.model);
    expect(config.healing.auto_apply).toBe(DEFAULT_CONFIG.healing.auto_apply);
    expect(config.healing.output).toBe(DEFAULT_CONFIG.healing.output);
  });

  it("normalizes legacy spec into openapi contract", async () => {
    const yaml = `
apis:
  - name: payments
    spec: https://example.com/spec.json
    scan_paths: ["src/**"]
`;
    await writeFile(CONFIG_PATH, yaml, "utf-8");
    const config = await loadConfig(CONFIG_PATH);

    expect(config.apis[0].contract?.type).toBe("openapi");
    expect(config.apis[0].needs_resolve).toBe(false);
  });

  it("uses default apis when none provided", async () => {
    const yaml = `
ai:
  provider: ollama
`;
    await writeFile(CONFIG_PATH, yaml, "utf-8");
    const config = await loadConfig(CONFIG_PATH);

    expect(config.apis).toEqual([]);
    expect(config.ai.provider).toBe("ollama");
  });

  it("preserves custom base_url in ai config", async () => {
    const yaml = `
ai:
  provider: openai
  base_url: http://localhost:11434/v1
`;
    await writeFile(CONFIG_PATH, yaml, "utf-8");
    const config = await loadConfig(CONFIG_PATH);

    expect(config.ai.base_url).toBe("http://localhost:11434/v1");
  });

  it("preserves api_key_env in ai config", async () => {
    const yaml = `
ai:
  provider: openai
  model: kimi-k2.5
  base_url: https://api.moonshot.cn/v1
  api_key_env: MOONSHOT_API_KEY
`;
    await writeFile(CONFIG_PATH, yaml, "utf-8");
    const config = await loadConfig(CONFIG_PATH);

    expect(config.ai.api_key_env).toBe("MOONSHOT_API_KEY");
    expect(config.ai.base_url).toBe("https://api.moonshot.cn/v1");
  });
});

describe("saveConfig", () => {
  it("saves and round-trips a config", async () => {
    const config = {
      apis: [
        { name: "test-api", spec: "https://example.com/spec.json", scan_paths: ["src/**/*.ts"] },
      ],
      ai: { provider: "openai" as const, model: "gpt-4o" },
      healing: { auto_apply: "none" as const, output: "patch" as const },
    };

    await saveConfig(CONFIG_PATH, config);
    const loaded = await loadConfig(CONFIG_PATH);

    expect(loaded.apis[0].name).toBe("test-api");
    expect(loaded.ai.provider).toBe("openai");
    expect(loaded.ai.model).toBe("gpt-4o");
    expect(loaded.healing.auto_apply).toBe("none");
  });
});
