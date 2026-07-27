import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { parse, stringify } from "yaml";
import { ApihealerConfig, DEFAULT_CONFIG } from "./schema.js";

export async function loadConfig(path: string): Promise<ApihealerConfig> {
  if (!existsSync(path)) {
    throw new Error(
      `Config file not found: ${path}\nRun "apihealer init" to create one.`,
    );
  }

  const raw = await readFile(path, "utf-8");
  const parsed = parse(raw) as Partial<ApihealerConfig>;

  return {
    apis: parsed.apis ?? DEFAULT_CONFIG.apis,
    ai: { ...DEFAULT_CONFIG.ai, ...parsed.ai },
    healing: { ...DEFAULT_CONFIG.healing, ...parsed.healing },
  };
}

export async function saveConfig(
  path: string,
  config: ApihealerConfig,
): Promise<void> {
  const content = stringify(config, { indent: 2 });
  await writeFile(path, content, "utf-8");
}
