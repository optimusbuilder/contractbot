import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import {
  fetchSpec,
  diffSpecs,
  getCachedSpec,
  cacheSpec,
} from "../../differ/index.js";
import { scanForApiUsages } from "../../scanner/index.js";
import { createProvider } from "../../providers/index.js";
import { healCode } from "../../healer/index.js";
import { savePatch, displayDiffResult, displayHealResult } from "../../output/index.js";

interface HealOptions {
  config: string;
  dryRun: boolean;
}

export async function healCommand(options: HealOptions): Promise<void> {
  const config = await loadConfig(options.config);

  if (config.apis.length === 0) {
    console.log(chalk.yellow("No APIs configured. Edit .apihealer.yml first."));
    return;
  }

  for (const api of config.apis) {
    const spinner = ora(`Fetching spec for ${api.name}...`).start();

    try {
      const newSpec = await fetchSpec(api.spec);
      const cachedSpec = await getCachedSpec(api.name);

      if (!cachedSpec) {
        await cacheSpec(api.name, newSpec);
        spinner.info(`${api.name}: First run — spec cached. Run heal again after the API changes.`);
        continue;
      }

      const diff = diffSpecs(api.name, cachedSpec, newSpec);

      if (diff.changes.length === 0) {
        spinner.succeed(`${api.name}: No changes detected`);
        continue;
      }

      spinner.text = `${api.name}: ${diff.changes.length} change(s) found. Scanning codebase...`;

      const apiPaths = Object.keys(newSpec.paths ?? {});
      const usages = await scanForApiUsages(api.scan_paths, apiPaths);

      if (usages.length === 0) {
        spinner.warn(`${api.name}: Changes detected but no API usages found in your code`);
        displayDiffResult(diff);
        await cacheSpec(api.name, newSpec);
        continue;
      }

      spinner.text = `${api.name}: Found ${usages.length} usage(s). Generating fixes...`;

      if (options.dryRun) {
        spinner.info(`${api.name}: Dry run — showing changes without generating patches`);
        displayDiffResult(diff);
        console.log(chalk.dim(`  ${usages.length} API usage(s) found across ${new Set(usages.map((u) => u.filePath)).size} file(s)`));
        await cacheSpec(api.name, newSpec);
        continue;
      }

      const provider = createProvider(config.ai);
      const healResult = await healCode(diff, usages, provider);

      if (healResult.patches.length === 0) {
        spinner.succeed(`${api.name}: Changes detected but no code modifications needed`);
        displayDiffResult(diff);
        await cacheSpec(api.name, newSpec);
        continue;
      }

      const patchId = await savePatch(healResult);
      spinner.succeed(`${api.name}: Generated ${healResult.patches.length} patch(es)`);

      displayDiffResult(diff);
      displayHealResult(healResult, patchId);

      await cacheSpec(api.name, newSpec);
    } catch (error) {
      spinner.fail(
        `${api.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
}
