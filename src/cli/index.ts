#!/usr/bin/env node

import { Command } from "commander";
import { setupCommand } from "./commands/setup.js";
import { initCommand } from "./commands/init.js";
import { applyCommand } from "./commands/apply.js";
import { ciCommand } from "./commands/ci.js";
import { resolveCommand } from "./commands/resolve.js";
import { baselineCommand } from "./commands/baseline.js";
import { acceptCommand } from "./commands/accept.js";
import { suggestCommand } from "./commands/suggest.js";
import { showCommand } from "./commands/show.js";
import { ignoreCommand } from "./commands/ignore.js";
import { discoverCommand } from "./commands/discover.js";
import { investigateCommand } from "./commands/investigate.js";
import { reviewCommand } from "./commands/review.js";
import { logger, LogLevel, OutputFormat } from "../logger.js";

const program = new Command();

program
  .name("contractbot")
  .description(
    "Review approved OpenAPI contract changes before deployment.",
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
    "Discover APIs, resolve contract sources, and write .contractbot.yml",
  )
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .option("--skip-detect", "Skip auto-detection and create an empty config", false)
  .option("--force", "Overwrite existing workflow / re-init when config exists", false)
  .option("--web-search", "Allow one-time web search while resolving contracts", false)
  .action(setupCommand);

program
  .command("init")
  .description("Discover APIs and create .contractbot.yml (prefer: contractbot setup)")
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .option("--skip-detect", "Skip auto-detection and create a blank config", false)
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
  .description("Deprecated alias for a non-blocking compatibility check")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--min-urgency <level>", "Only check APIs at or above this urgency (critical, normal, low)", "low")
  .action((options) =>
    ciCommand({
      config: options.config,
      minUrgency: options.minUrgency,
      failOn: "none",
    }),
  );

program
  .command("review")
  .description("Show validated AI discovery findings awaiting human review")
  .option("-d, --dir <path>", "Project directory", ".")
  .action(reviewCommand);

program
  .command("investigate <api>")
  .description("Use AI to assess a confirmed pending change-set against local usage evidence")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .action(investigateCommand);

program
  .command("discover")
  .description("Print structured discovery evidence; use --ai for opt-in suggestions")
  .option("-d, --dir <path>", "Project directory to inspect", ".")
  .option("-c, --config <path>", "Path to config file")
  .option("--ai", "Ask the configured LLM to interpret identifier-only evidence", false)
  .option("--agent", "Run an opt-in bounded AI investigation over cited call-site evidence", false)
  .option("--refresh", "Rebuild the local integration evidence index before agent discovery", false)
  .action(discoverCommand);

program
  .command("ignore <name>")
  .description("Persistently ignore a discovered API and remove it from this config")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .action(ignoreCommand);

program
  .command("show <api>")
  .description("Show a readable pending API change-set")
  .action(showCommand);

program
  .command("suggest <api>")
  .description("Draft a local migration patch for a confirmed pending change-set")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .action(suggestCommand);

program
  .command("apply <patchId>")
  .description("Apply a generated patch to your codebase")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--min-confidence <level>", "Only apply patches at or above this confidence (high, medium, low)")
  .option("--interactive", "Confirm each file change interactively", false)
  .option("--undo", "Undo a previously applied patch using backup ID", false)
  .action(applyCommand);

program
  .command("ci")
  .description("Run API contract check for CI/CD pipelines")
  .option("-c, --config <path>", "Path to config file", ".contractbot.yml")
  .option("--fail-on <level>", "Exit non-zero on: breaking, any, none", "breaking")
  .option("--output <path>", "Write JSON report to file")
  .option("--min-urgency <level>", "Only check APIs at or above this urgency", "low")
  .action(ciCommand);

program.parse();
