import { existsSync } from "fs";
import { resolve } from "path";
import chalk from "chalk";
import ora from "ora";
import { loadConfig, saveConfig } from "../../config/loader.js";
import { DEFAULT_CONFIG, ContractbotConfig, ApiEntry } from "../../config/schema.js";
import {
  detectApis,
  candidateToApiEntry,
  ApiCandidate,
} from "../../detector/index.js";
import { resolveApiContract } from "../../resolver/index.js";
import { writeGithubAction } from "../../output/github-action.js";
import { logger } from "../../logger.js";

interface SetupOptions {
  dir: string;
  skipDetect?: boolean;
  force?: boolean;
  webSearch?: boolean;
}

/**
 * One-shot onboarding: discover → resolve → write config and a CI workflow.
 * Remaining human steps: approve contract baselines and push.
 */
export async function setupCommand(options: SetupOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const configPath = `${projectDir}/.contractbot.yml`;
  const configExists = existsSync(configPath);

  if (configExists && options.force) {
    // Full re-init below
  } else if (configExists) {
    logger.info("Config exists — resolving pending contracts");
    if (!logger.isJsonMode()) {
      console.log(chalk.dim(`Using existing ${configPath}`));
    }
    await resolvePending(configPath, options.webSearch);
    await ensureAction(projectDir, options.force);
    printNextSteps(configPath);
    return;
  }

  // 1. Discover
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
      console.log(`  ${badge} ${chalk.cyan.bold(api.name)} ${chalk.dim(`[${api.confidence} confidence]`)}`);
      for (const ev of api.evidence.slice(0, 3)) {
        console.log(`      ${chalk.dim("•")} ${chalk.dim(ev)}`);
      }
    }
    console.log();
  }

  const apis: ApiEntry[] =
    candidates.length > 0 ? candidates.map(candidateToApiEntry) : [];

  let config: ContractbotConfig = {
    ...DEFAULT_CONFIG,
    apis,
  };

  // 2. Resolve inline (no web search by default)
  if (apis.length > 0) {
    const spinner = logger.isJsonMode()
      ? null
      : ora("Resolving contracts...").start();

    let resolvedCount = 0;
    const updated: ApiEntry[] = [];

    for (const api of apis) {
      try {
        const result = await resolveApiContract(api, {
          webSearch: options.webSearch,
        });
        updated.push(result.api);
        if (result.resolved) resolvedCount++;
      } catch {
        updated.push(api);
      }
    }

    config = { ...config, apis: updated };
    spinner?.succeed(
      `Resolved ${resolvedCount}/${apis.length} contract${apis.length !== 1 ? "s" : ""}`,
    );
  }

  // 3. Write config
  await saveConfig(configPath, config);
  logger.info("Created .contractbot.yml", {
    event: "setup_complete",
    apis: config.apis.length,
  });

  if (!logger.isJsonMode()) {
    if (apis.length === 0) {
      console.log(chalk.yellow("✓ Created .contractbot.yml (no APIs detected)"));
      console.log(
        chalk.dim(
          "  Add APIs to the file, or re-run after installing SDKs (stripe, @supabase/supabase-js, …)",
        ),
      );
    } else {
      const unresolved = config.apis.filter(
        (a) => a.needs_resolve || a.contract?.type === "unresolved",
      ).length;
      console.log(chalk.green.bold("✓ Created .contractbot.yml"));
      console.log(
        chalk.dim(
          `  ${config.apis.length} API(s)` +
            (unresolved > 0
              ? ` (${unresolved} still unresolved — try: contractbot resolve --web-search)`
              : ""),
        ),
      );
    }
  }

  await ensureAction(projectDir, true);
  printNextSteps(configPath);
}

async function ensureAction(projectDir: string, force?: boolean): Promise<void> {
  const result = await writeGithubAction({ dir: projectDir, force });
  if (!logger.isJsonMode()) {
    console.log(result.skipped ? chalk.dim(`Workflow already exists: ${result.path}`) : chalk.green(`Created ${result.path}`));
  }
}

async function resolvePending(
  configPath: string,
  webSearch?: boolean,
): Promise<void> {
  const config = await loadConfig(configPath);
  const targets = config.apis.filter(
    (a) => a.needs_resolve || a.contract?.type === "unresolved",
  );
  if (targets.length === 0) return;

  const spinner = logger.isJsonMode()
    ? null
    : ora(`Resolving ${targets.length} pending contract(s)...`).start();

  let resolvedCount = 0;
  for (const api of targets) {
    try {
      const result = await resolveApiContract(api, { webSearch });
      const idx = config.apis.findIndex((a) => a.name === api.name);
      if (idx >= 0) config.apis[idx] = result.api;
      if (result.resolved) resolvedCount++;
    } catch {
      /* keep original */
    }
  }

  await saveConfig(configPath, config);
  spinner?.succeed(`Resolved ${resolvedCount}/${targets.length}`);
}

function printNextSteps(configPath: string): void {
  if (logger.isJsonMode()) return;

  console.log();
  console.log(chalk.white.bold("Almost done — 2 steps left:"));
  console.log();

  console.log(chalk.cyan("  1.") + " Fetch and review the initial baselines:");
  console.log(chalk.dim("     contractbot baseline"));
  console.log(chalk.cyan("  2.") + " Commit and push:");
  console.log(
    chalk.dim(
      `     git add ${configPath} .contractbot/baselines && git commit -m "chore: add contractbot" && git push`,
    ),
  );
  console.log();
  console.log(
    chalk.dim(
      "CI compares only against approved baselines. AI suggestions are manual and local.",
    ),
  );
  console.log();
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
