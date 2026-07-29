import { existsSync } from "fs";
import { resolve } from "path";
import { loadDiscoveryReview } from "../../investigator/index.js";
import { loadConfig, saveConfig } from "../../config/loader.js";
import { ApiEntry, DEFAULT_CONFIG } from "../../config/schema.js";

interface ReviewOptions { dir: string; config?: string; contract?: string; source?: string; package?: string }

export async function reviewCommand(action: string | undefined, provider: string | undefined, options: ReviewOptions): Promise<void> {
  const dir = resolve(options.dir);
  if (!action) {
    const review = await loadDiscoveryReview(dir);
    if (!review) throw new Error("No agent discovery review queue found. Run contractbot discover --agent first.");
    console.log(JSON.stringify(review, null, 2));
    return;
  }
  if (!provider) throw new Error(`review ${action} requires a provider name`);
  const configPath = options.config ?? `${dir}/.contractbot.yml`;
  const config = existsSync(configPath) ? await loadConfig(configPath) : DEFAULT_CONFIG;
  const normalized = provider.toLowerCase();
  const review = await loadDiscoveryReview(dir) as { candidates?: Array<{ provider?: string }> } | null;
  if (!review?.candidates?.some((candidate) => candidate.provider === normalized)) {
    throw new Error(`${provider} is not in the current agent review queue.`);
  }

  if (action === "ignore" || action === "internal") {
    config.apis = config.apis.filter((api) => api.name.toLowerCase() !== normalized);
    const key = action === "ignore" ? "ignore" : "internal";
    const values = new Set(config.discovery?.[key] ?? []);
    values.add(normalized);
    config.discovery = { ...config.discovery, [key]: [...values].sort() };
    await saveConfig(configPath, config);
    console.log(`${action === "ignore" ? "Ignored" : "Marked internal"}: ${provider}`);
    return;
  }

  if (action !== "add") throw new Error("Review actions: add, ignore, internal");
  if (!options.contract || !["openapi", "sdk_package", "changelog"].includes(options.contract)) {
    throw new Error("review add requires --contract openapi|sdk_package|changelog");
  }
  if (!options.source) throw new Error("review add requires an approved --source URL or package name");
  const entry: ApiEntry = { name: normalized, scan_paths: ["src/**/*.ts", "src/**/*.js"] };
  if (options.contract === "openapi") {
    entry.contract = { type: "openapi", url: options.source, resolved_via: "manual" };
  } else if (options.contract === "sdk_package") {
    entry.contract = { type: "sdk_package", ecosystem: "npm", package: options.package ?? options.source, resolved_via: "manual" };
  } else {
    entry.contract = { type: "changelog", sources: [{ type: "url", url: options.source }], resolved_via: "manual" };
  }
  entry.needs_resolve = false;
  config.apis = [...config.apis.filter((api) => api.name.toLowerCase() !== normalized), entry];
  await saveConfig(configPath, config);
  console.log(`Added reviewed provider: ${provider}. Review the config before creating a baseline.`);
}
