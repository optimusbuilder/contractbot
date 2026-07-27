import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import { getChangeSet } from "../../differ/index.js";
import { scanAllLanguages } from "../../scanner/index.js";
import { createProvider } from "../../providers/index.js";
import { healCode, scorePatches } from "../../healer/index.js";
import { displayDiffResult, displayHealResult, savePatch } from "../../output/index.js";

interface SuggestOptions {
  config: string;
}

/** Generate a local migration draft from an already-confirmed contract change. */
export async function suggestCommand(apiName: string, options: SuggestOptions): Promise<void> {
  const config = await loadConfig(options.config);
  const api = config.apis.find((entry) => entry.name === apiName);
  if (!api) throw new Error(`API not found in config: ${apiName}`);

  const changeSet = await getChangeSet(apiName);
  if (!changeSet) {
    throw new Error(`No pending change-set for ${apiName}. Run contractbot ci first.`);
  }

  const usages = await scanAllLanguages(
    api.scan_paths,
    Object.keys(changeSet.nextSpec.paths ?? {}),
    api.languages,
  );
  if (usages.length === 0) {
    console.log(chalk.yellow(`${apiName}: no matching API usages found; no suggestion generated.`));
    return;
  }

  const provider = createProvider({
    ...config.ai,
    cache: config.ai.cache,
    budget_usd: config.ai.budget_usd,
    max_requests: config.ai.max_requests,
    requests_per_minute: config.ai.requests_per_minute,
  });
  const result = await healCode(changeSet.diff, usages, provider);

  displayDiffResult(changeSet.diff);
  if (result.patches.length === 0) {
    console.log(chalk.yellow("No migration suggestion was generated."));
    return;
  }

  const patchId = await savePatch(result);
  displayHealResult(result, patchId);
  const scored = scorePatches(result.patches, changeSet.diff.changes);
  console.log(chalk.dim(`  Review with contractbot apply ${patchId} --interactive`));
  console.log(chalk.dim(`  Average suggestion confidence: ${Math.round(scored.reduce((sum, patch) => sum + patch.score, 0) / scored.length)}%`));
}
