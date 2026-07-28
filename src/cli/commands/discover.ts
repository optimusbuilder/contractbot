import { existsSync } from "fs";
import { join, resolve } from "path";
import { collectDiscoveryEvidence } from "../../detector/index.js";
import { createProvider } from "../../providers/index.js";
import { DEFAULT_CONFIG } from "../../config/schema.js";
import { loadConfig } from "../../config/loader.js";

interface DiscoverOptions { dir: string; config?: string; ai?: boolean }

export async function discoverCommand(options: DiscoverOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const evidence = await collectDiscoveryEvidence(projectDir);
  if (!options.ai) {
    console.log(JSON.stringify(evidence, null, 2));
    return;
  }

  const configPath = options.config ?? join(projectDir, ".contractbot.yml");
  const config = existsSync(configPath) ? await loadConfig(configPath) : DEFAULT_CONFIG;
  const provider = createProvider(config.ai);
  const prompt = `Analyze these dependency identifiers for external API providers. Return JSON only: [{"name":"...","confidence":"high|medium|low","evidence":["..."],"suggestedType":"openapi|sdk_package|changelog|unknown"}]. Do not invent credentials, URLs, or claims not supported by this evidence. These are identifiers only, not source code.\n\n${JSON.stringify(evidence)}`;
  const response = await provider.generate(prompt, "You are a conservative API dependency analyst. Suggestions require human review and must cite supplied evidence.");
  console.log(response);
}
