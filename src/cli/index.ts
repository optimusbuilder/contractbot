#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { watchCommand } from "./commands/watch.js";
import { healCommand } from "./commands/heal.js";
import { applyCommand } from "./commands/apply.js";

const program = new Command();

program
  .name("apihealer")
  .description(
    "Self-healing API client — detects API contract changes and generates code fixes for your codebase.",
  )
  .version("0.1.0");

program
  .command("init")
  .description("Scan your project and create an .apihealer.yml config file")
  .option("-d, --dir <path>", "Project directory to scan", ".")
  .action(initCommand);

program
  .command("watch")
  .description("Fetch latest API specs and report changes since last check")
  .option("-c, --config <path>", "Path to config file", ".apihealer.yml")
  .action(watchCommand);

program
  .command("heal")
  .description(
    "Detect API changes and generate code patches for your codebase",
  )
  .option("-c, --config <path>", "Path to config file", ".apihealer.yml")
  .option(
    "--dry-run",
    "Show what would be changed without generating patches",
    false,
  )
  .action(healCommand);

program
  .command("apply <patchId>")
  .description("Apply a generated patch to your codebase")
  .option("-c, --config <path>", "Path to config file", ".apihealer.yml")
  .action(applyCommand);

program.parse();
