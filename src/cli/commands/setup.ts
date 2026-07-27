import { existsSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";
import { spawn } from "child_process";
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
  secret?: boolean;
  force?: boolean;
  webSearch?: boolean;
}

/**
 * One-shot onboarding: discover → resolve → write config + GitHub Action.
 * Remaining human steps: add CONTRACTBOT_API_KEY (or --secret) and push.
 */
export async function setupCommand(options: SetupOptions): Promise<void> {
  const projectDir = resolve(options.dir);
  const configPath = `${projectDir}/.contractbot.yml`;
  const configExists = existsSync(configPath);

  if (configExists && options.force) {
    // Full re-init below
  } else if (configExists) {
    logger.info("Config exists — resolving pending contracts and ensuring Action");
    if (!logger.isJsonMode()) {
      console.log(chalk.dim(`Using existing ${configPath}`));
    }
    await resolvePending(configPath, options.webSearch);
    await ensureAction(projectDir, options.force);
    const secretOk = await maybeSetSecret(options.secret, projectDir);
    printNextSteps(configPath, secretOk);
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
      console.log(`  ${badge} ${chalk.cyan.bold(api.name)}`);
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

  // 4. Write Action
  await ensureAction(projectDir, true);

  // 5. Optional secret
  const secretOk = await maybeSetSecret(options.secret, projectDir);

  printNextSteps(configPath, secretOk);
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

async function ensureAction(projectDir: string, force?: boolean): Promise<void> {
  const result = await writeGithubAction({ dir: projectDir, force });
  if (logger.isJsonMode()) return;

  if (result.skipped) {
    console.log(chalk.dim(`  Workflow already exists: ${result.path}`));
  } else {
    console.log(chalk.green.bold(`✓ Created ${result.path}`));
  }
}

async function maybeSetSecret(
  wantSecret: boolean | undefined,
  projectDir: string,
): Promise<boolean> {
  if (!wantSecret) return false;

  const ghOk = await commandExists("gh");
  if (!ghOk) {
    if (!logger.isJsonMode()) {
      console.log(
        chalk.yellow(
          "⚠ --secret requires GitHub CLI (gh). Install: https://cli.github.com",
        ),
      );
      console.log(
        chalk.dim(
          "  Or add the secret manually: gh secret set CONTRACTBOT_API_KEY",
        ),
      );
    }
    return false;
  }

  let key =
    process.env.CONTRACTBOT_API_KEY ||
    process.env.LLM_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY;

  if (!key && !logger.isJsonMode()) {
    key = await promptSecret(
      "Paste your LLM API key (stored as GitHub secret CONTRACTBOT_API_KEY): ",
    );
  }

  if (!key) {
    if (!logger.isJsonMode()) {
      console.log(chalk.yellow("⚠ No key provided — skip secret setup"));
    }
    return false;
  }

  const spinner = logger.isJsonMode()
    ? null
    : ora("Setting GitHub secret CONTRACTBOT_API_KEY...").start();

  try {
    await runGhSecretSet("CONTRACTBOT_API_KEY", key, projectDir);
    spinner?.succeed("Set repository secret CONTRACTBOT_API_KEY");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    spinner?.fail(`Could not set secret: ${msg}`);
    if (!logger.isJsonMode()) {
      console.log(
        chalk.dim("  Add it in GitHub → Settings → Secrets → Actions"),
      );
    }
    return false;
  }
}

function printNextSteps(configPath: string, secretDone?: boolean): void {
  if (logger.isJsonMode()) return;

  const remaining = secretDone ? 1 : 2;
  console.log();
  console.log(
    chalk.white.bold(
      remaining === 1 ? "Almost done — 1 step left:" : "Almost done — 2 steps left:",
    ),
  );
  console.log();

  let n = 1;
  if (!secretDone) {
    console.log(
      chalk.cyan(`  ${n}.`) +
        ` Add repo secret ${chalk.white("CONTRACTBOT_API_KEY")} (your LLM key)`,
    );
    console.log(
      chalk.dim(
        `     gh secret set CONTRACTBOT_API_KEY   # or re-run: contractbot setup --secret`,
      ),
    );
    n++;
  } else {
    console.log(chalk.dim("  ✓ Secret configured"));
  }

  console.log(chalk.cyan(`  ${n}.`) + " Commit and push:");
  console.log(
    chalk.dim(
      `     git add ${configPath} .github/workflows/contractbot.yml && git commit -m "chore: add contractbot" && git push`,
    ),
  );
  console.log();
  console.log(
    chalk.dim(
      "Watch runs every 15m (no LLM). Fix PRs open only when something changed.",
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

function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, ["--version"], {
      stdio: "ignore",
      shell: false,
    });
    child.on("error", () => resolvePromise(false));
    child.on("close", (code) => resolvePromise(code === 0));
  });
}

function runGhSecretSet(
  name: string,
  value: string,
  cwd: string,
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("gh", ["secret", "set", name, "--body", value], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || `gh exited ${code}`));
    });
  });
}

function promptSecret(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer.trim());
    });
  });
}
