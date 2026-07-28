import chalk from "chalk";
import { getChangeSet } from "../../differ/index.js";
import type { OpenApiChangeSet } from "../../differ/index.js";

export async function showCommand(apiName: string): Promise<void> {
  const changeSet = await getChangeSet(apiName);
  if (!changeSet) {
    throw new Error(`No pending change-set for ${apiName}. Run contractbot ci first.`);
  }
  console.log(formatChangeSet(changeSet));
}

export function formatChangeSet(changeSet: OpenApiChangeSet): string {
  const lines = [
    "",
    chalk.white.bold(`${changeSet.apiName}: pending API contract change`),
    chalk.dim(`Detected: ${changeSet.detectedAt}`),
    chalk.dim(`Source: ${changeSet.sourceUrl}`),
    chalk.dim(`Version: ${changeSet.diff.oldVersion ?? "unknown"} -> ${changeSet.diff.newVersion ?? "unknown"}`),
    "",
    chalk.white.bold("Changes"),
  ];

  for (const change of changeSet.diff.changes) {
    const marker = change.severity === "breaking" ? chalk.red("x") : change.severity === "non-breaking" ? chalk.yellow("~") : chalk.dim("i");
    lines.push(`  ${marker} ${change.description}`);
  }

  if (changeSet.verification) {
    lines.push("", chalk.white.bold("Verification"));
    const status = changeSet.verification.passed ? chalk.green("passed") : chalk.red("failed");
    lines.push(`  ${status}: ${changeSet.verification.command}`);
    if (changeSet.verification.output) {
      lines.push(chalk.dim(`  ${changeSet.verification.output}`));
    }
  }

  lines.push(
    "",
    chalk.white.bold("Next steps"),
    `  1. Update the integration and rerun its verification command.`,
    `  2. Optional: contractbot suggest ${changeSet.apiName}`,
    `  3. Accept the reviewed contract: contractbot accept ${changeSet.apiName}`,
  );
  return lines.join("\n");
}
