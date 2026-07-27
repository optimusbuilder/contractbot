#!/usr/bin/env node

import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { initCommand } from "./commands/init.js";
import { watchCommand } from "./commands/watch.js";
import { healCommand } from "./commands/heal.js";
import { applyCommand } from "./commands/apply.js";
import { ciCommand } from "./commands/ci.js";
import { prCommand } from "./commands/pr.js";
import { resolveCommand } from "./commands/resolve.js";
import { baselineCommand } from "./commands/baseline.js";
import { acceptCommand } from "./commands/accept.js";
import { logger, LogLevel, OutputFormat } from "../logger.js";

const program = new Command();

program
  .name("contractbot")
  .description(
    "CI-native compatibility checks for external APIs.",
  )
  .version("0.1.0")
  .option("--log-level <level>", "Log level: debug, info, warn, error", "info")
  .option("--log-file <path>", "Write structured JSON logs to file")
  .option("--json", "Output machine-readable JSON instead of human-formatted text", false)
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    logger.configure({
      level: opts.logLevel as LogLevel,
      format: opts.json ? ("json" as OutputFormat) : ("human" as OutputFormat),
      logFile: opts.logFile,
    });
  });

program
  .command("baseline")
  .description("Fetch and save approved OpenAPI contract baselines")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--api <name>", "Baseline a single API")
  .option("--force", "Replace an existing approved baseline", false)
  .action(baselineCommand);

program
  .command("accept <api>")
  .description("Accept a pending OpenAPI change-set as the new baseline")
  .action(acceptCommand);

program
  .command("setup")
  .description(
    "One-shot setup: discover APIs, resolve contracts, write .contractbot.yml + GitHub Action",
  )
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .option("--skip-detect", "Skip auto-detection and create an empty config", false)
  .option("--secret", "Set CONTRACTBOT_API_KEY via gh secret set (prompts or uses env)", false)
  .option("--force", "Overwrite existing workflow / re-init when config exists", false)
  .option("--web-search", "Allow one-time web search while resolving contracts", false)
  .action(setupCommand);

program
  .command("init")
  .description("Discover APIs and create .contractbot.yml (prefer: contractbot setup)")
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .option("--skip-detect", "Skip auto-detection and create a blank config", false)
  .option("--generate-action", "Also generate a GitHub Actions workflow", false)
  .action(initCommand);

program
  .command("resolve")
  .description("Resolve unresolved API contracts (catalog, well-known OpenAPI, SDK, optional web search)")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--web-search", "Allow one-time web search to find OpenAPI specs", false)
  .option("--api <name>", "Resolve a single API by name")
  .action(resolveCommand);

program
  .command("watch")
  .description("Fetch latest API specs / SDK versions and report changes since last check")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--min-urgency <level>", "Only check APIs at or above this urgency (critical, normal, low)", "low")
  .action(watchCommand);

program
  .command("heal")
  .description(
    "Detect API changes and generate code patches for your codebase",
  )
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option(
    "--dry-run",
    "Show what would be changed without generating patches",
    false,
  )
  .option("--preview", "Show detailed diff preview with confidence scores", false)
  .option("--validate", "Run typecheck and tests after patching; retry on failure", false)
  .option("--min-urgency <level>", "Only heal APIs at or above this urgency", "low")
  .action(healCommand);

program
  .command("apply <patchId>")
  .description("Apply a generated patch to your codebase")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--min-confidence <level>", "Only apply patches at or above this confidence (high, medium, low)")
  .option("--interactive", "Confirm each file change interactively", false)
  .option("--undo", "Undo a previously applied patch using backup ID", false)
  .action(applyCommand);

program
  .command("pr")
  .description("Detect API changes, generate fixes, and open PRs")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--base-branch <branch>", "Base branch for PRs (defaults to current branch)")
  .option("--per-file", "Create one PR per affected file instead of one grouped PR", false)
  .option("--draft", "Create PRs as drafts", false)
  .option("--labels <labels>", "Comma-separated labels to add", "contractbot,automated")
  .option("--reviewers <users>", "Comma-separated GitHub usernames to request review from")
  .option("--assignees <users>", "Comma-separated GitHub usernames to assign")
  .option("--dry-run", "Show what PRs would be created without actually creating them", false)
  .option("--min-urgency <level>", "Only process APIs at or above this urgency", "low")
  .action(prCommand);

program
  .command("ci")
  .description("Run API contract check for CI/CD pipelines")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--fail-on <level>", "Exit non-zero on: breaking, any, none", "breaking")
  .option("--output <path>", "Write JSON report to file")
  .option("--generate-action", "Generate a GitHub Actions workflow (watch → heal → PR)", false)
  .option("--auto-heal", "Automatically generate patches for breaking changes", false)
  .option("--min-urgency <level>", "Only check APIs at or above this urgency", "low")
  .action(ciCommand);

program.parse();
