import ora from "ora";
import chalk from "chalk";
import { loadConfig } from "../../config/loader.js";
import { fetchSpec, diffSpecs, getCachedSpec, cacheSpec } from "../../differ/index.js";
import { displayDiffResult } from "../../output/index.js";

interface WatchOptions {
  config: string;
}

export async function watchCommand(options: WatchOptions): Promise<void> {
  const config = await loadConfig(options.config);

  if (config.apis.length === 0) {
    console.log(chalk.yellow("No APIs configured. Edit .apihealer.yml first."));
    return;
  }

  let totalBreaking = 0;
  let totalNonBreaking = 0;

  for (const api of config.apis) {
    const spinner = ora(`Checking ${api.name}...`).start();

    try {
      const newSpec = await fetchSpec(api.spec);
      const cachedSpec = await getCachedSpec(api.name);

      if (!cachedSpec) {
        await cacheSpec(api.name, newSpec);
        spinner.info(
          `${api.name}: First run — spec cached. Changes will be detected on next run.`,
        );
        continue;
      }

      const diff = diffSpecs(api.name, cachedSpec, newSpec);
      await cacheSpec(api.name, newSpec);

      if (diff.changes.length === 0) {
        spinner.succeed(`${api.name}: No changes`);
      } else if (diff.breakingCount > 0) {
        spinner.fail(
          `${api.name}: ${diff.breakingCount} breaking, ${diff.nonBreakingCount} non-breaking`,
        );
      } else {
        spinner.warn(
          `${api.name}: ${diff.nonBreakingCount} non-breaking change(s)`,
        );
      }

      displayDiffResult(diff);
      totalBreaking += diff.breakingCount;
      totalNonBreaking += diff.nonBreakingCount;
    } catch (error) {
      spinner.fail(
        `${api.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  console.log();
  if (totalBreaking > 0) {
    console.log(
      chalk.red.bold(
        `⚠ ${totalBreaking} breaking change(s) detected. Run "apihealer heal" to generate fixes.`,
      ),
    );
  } else if (totalNonBreaking > 0) {
    console.log(
      chalk.yellow(
        `${totalNonBreaking} non-breaking change(s) detected. Your code likely still works.`,
      ),
    );
  } else {
    console.log(chalk.green("✓ All APIs are stable."));
  }
}
