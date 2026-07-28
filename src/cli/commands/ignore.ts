import chalk from "chalk";
import { loadConfig, saveConfig } from "../../config/loader.js";

interface IgnoreOptions {
  config: string;
}

export async function ignoreCommand(name: string, options: IgnoreOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const normalized = name.trim().toLowerCase();
  const ignored = new Set((config.discovery?.ignore ?? []).map((entry) => entry.toLowerCase()));
  ignored.add(normalized);

  const before = config.apis.length;
  config.apis = config.apis.filter((api) => api.name.toLowerCase() !== normalized);
  config.discovery = { ...config.discovery, ignore: [...ignored].sort() };
  await saveConfig(options.config, config);

  const removed = before - config.apis.length;
  console.log(chalk.green(`✓ Ignored ${name}${removed > 0 ? " and removed it from this config" : ""}`));
}
