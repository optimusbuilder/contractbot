import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { parse, stringify } from "yaml";
import {
  ContractbotConfig,
  DEFAULT_CONFIG,
  normalizeApiEntry,
} from "./schema.js";

export async function loadConfig(path: string): Promise<ContractbotConfig> {
  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\nRun "contractbot setup" to create one.`,
    );
  }

  const raw = await readFile(path, "utf-8");
  const parsed = parse(raw) as Partial<ContractbotConfig>;

  const apis = (parsed.apis ?? DEFAULT_CONFIG.apis).map(normalizeApiEntry);

  return {
    apis,
    discovery: { ...DEFAULT_CONFIG.discovery, ...parsed.discovery },
    ai: { ...DEFAULT_CONFIG.ai, ...parsed.ai },
    healing: { ...DEFAULT_CONFIG.healing, ...parsed.healing },
  };
}

export async function saveConfig(
  path: string,
  config: ContractbotConfig,
): Promise<void> {
  const content = stringify(config, { indent: 2 });
  await writeFile(path, content, "utf-8");
}
