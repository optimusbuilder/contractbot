import { existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { saveConfig } from "../../config/loader.js";
import { DEFAULT_CONFIG, ContractbotConfig } from "../../config/schema.js";
import {
  detectApis,
  candidateToApiEntry,
  ApiCandidate,
} from "../../detector/index.js";
import { logger } from "../../logger.js";

interface InitOptions {
  dir: string;
  skipDetect?: boolean;
}

/**
 * Power-user: write `.contractbot.yml` only.
 * Prefer `contractbot setup` for the full 2–3 step onboarding.
 */
export async function initCommand(options: InitOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const configPath = `${projectDir}/.contractbot.yml`;

  if (existsSync(configPath)) {
    logger.warn(`Config already exists: ${configPath}`);
    if (!logger.isJsonMode()) {
      console.log(chalk.dim("Delete it first if you want to reinitialize."));
      console.log(chalk.dim("Or run: contractbot setup  (resolve + Action if needed)"));
    }
    return;
  }

  let candidates: ApiCandidate[] = [];

  if (!options.skipDetect) {
    const spinner = logger.isJsonMode()
      ? null
      : ora("Scanning project for API usage...").start();

    try {
      const result = await detectApis(projectDir);
      candidates = result.candidates;
      spinner?.succeed(
        `Found ${candidates.length} API dependenc${candidates.length !== 1 ? "ies" : "y"}`,
      );
      logger.info("Discovery complete", {
        event: "discover",
        count: candidates.length,
        names: candidates.map((c) => c.name),
      });
    } catch {
      spinner?.warn("Auto-detection failed");
      logger.warn("Auto-detection failed");
    }
  }

  if (candidates.length > 0 && !logger.isJsonMode()) {
    console.log();
    console.log(chalk.white.bold("Detected API dependencies:"));
    console.log();

    for (const api of candidates) {
      const badge = confidenceBadge(api.confidence);
      const status = api.needsResolve
        ? chalk.yellow("needs resolve")
        : chalk.green(
            api.suggestedContract?.type === "openapi"
              ? "openapi"
              : api.suggestedContract?.type === "sdk_package"
                ? "sdk"
                : "ok",
          );
      console.log(`  ${badge} ${chalk.cyan.bold(api.name)}  ${status}`);
      for (const ev of api.evidence.slice(0, 3)) {
        console.log(`      ${chalk.dim("•")} ${chalk.dim(ev)}`);
      }
    }
  }

  const apis =
    candidates.length > 0 ? candidates.map(candidateToApiEntry) : [];

  const config: ContractbotConfig = {
    ...DEFAULT_CONFIG,
    apis,
  };

  await saveConfig(configPath, config);

  const unresolved = apis.filter((a) => a.needs_resolve).length;

  logger.info("Created .contractbot.yml", {
    event: "init_complete",
    apis: apis.length,
    unresolved,
  });

  if (!logger.isJsonMode()) {
    console.log();
    if (apis.length === 0) {
      console.log(chalk.yellow("✓ Created .contractbot.yml (no APIs detected)"));
      console.log(
        chalk.dim(
          "  Add APIs manually, or re-run after installing SDKs (stripe, @supabase/supabase-js, …)",
        ),
      );
    } else {
      console.log(chalk.green.bold("✓ Created .contractbot.yml"));
      console.log(
        chalk.dim(
          `  ${apis.length} API(s) written` +
            (unresolved > 0
              ? ` (${unresolved} need resolve)`
              : ""),
        ),
      );
    }
    console.log();
    console.log(chalk.white("Tip: prefer one-shot setup:"));
    console.log(chalk.dim("  contractbot setup          # discover + resolve + config"));
    console.log();
    console.log(chalk.white("Or continue manually:"));
    if (unresolved > 0) {
      console.log(chalk.dim("  1. contractbot resolve"));
    }
    console.log(chalk.dim("  • Run contractbot baseline, then commit & push"));
    console.log();
  }

}

function confidenceBadge(confidence: "high" | "medium" | "low"): string {
  switch (confidence) {
    case "high":
      return chalk.green("●");
    case "medium":
      return chalk.yellow("●");
    case "low":
      return chalk.dim("●");
  }
}
