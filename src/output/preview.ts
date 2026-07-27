import chalk from "chalk";
import { createTwoFilesPatch } from "diff";
import { ScoredPatch } from "../healer/confidence.js";

/**
 * Displays a rich preview of scored patches with colored diffs
 * and confidence indicators.
 */
export function displayPatchPreview(patches: ScoredPatch[]): void {
  console.log();
  console.log(chalk.bold("Patch Preview"));
  console.log(chalk.dim("─".repeat(60)));
  console.log();

  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i];
    displaySinglePatchPreview(patch, i + 1, patches.length);
  }

  console.log();
  displaySummaryTable(patches);
}

function displaySinglePatchPreview(
  patch: ScoredPatch,
  index: number,
  total: number,
): void {
  const badge = confidenceBadge(patch.confidence, patch.score);
  const header = `[${index}/${total}] ${patch.filePath}`;

  console.log(`${badge} ${chalk.cyan.bold(header)}`);
  console.log(`  ${chalk.dim(patch.description)}`);
  console.log();

  for (const reason of patch.reasons) {
    const icon = reason.includes("Simple") || reason.includes("Small")
      ? chalk.green("  +")
      : reason.includes("TODO") || reason.includes("No directly")
        ? chalk.red("  -")
        : chalk.yellow("  ~");
    console.log(`${icon} ${chalk.dim(reason)}`);
  }

  console.log();

  const diff = createTwoFilesPatch(
    patch.filePath,
    patch.filePath,
    patch.originalContent,
    patch.patchedContent,
    "before",
    "after",
    { context: 3 },
  );

  const lines = diff.split("\n");
  const displayLines = lines.slice(2);
  const maxLines = 40;
  const truncated = displayLines.length > maxLines;
  const toShow = truncated ? displayLines.slice(0, maxLines) : displayLines;

  for (const line of toShow) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      console.log(chalk.green(`  ${line}`));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      console.log(chalk.red(`  ${line}`));
    } else if (line.startsWith("@@")) {
      console.log(chalk.cyan(`  ${line}`));
    } else {
      console.log(chalk.dim(`  ${line}`));
    }
  }

  if (truncated) {
    console.log(chalk.dim(`  ... ${displayLines.length - maxLines} more lines`));
  }

  console.log();
  console.log(chalk.dim("─".repeat(60)));
  console.log();
}

function displaySummaryTable(patches: ScoredPatch[]): void {
  const high = patches.filter((p) => p.confidence === "high").length;
  const medium = patches.filter((p) => p.confidence === "medium").length;
  const low = patches.filter((p) => p.confidence === "low").length;

  console.log(chalk.bold("Summary:"));
  console.log(
    `  ${chalk.green("●")} High confidence: ${high}  ` +
    `${chalk.yellow("●")} Medium: ${medium}  ` +
    `${chalk.red("●")} Low: ${low}`,
  );
  console.log();
  console.log(chalk.dim("  Apply all:           contractbot apply <patch-id>"));
  console.log(chalk.dim("  Apply high-conf only: contractbot apply <patch-id> --min-confidence high"));
  console.log(chalk.dim("  Interactive:          contractbot apply <patch-id> --interactive"));
}

function confidenceBadge(level: string, score: number): string {
  const scoreStr = `${score}%`;
  switch (level) {
    case "high":
      return chalk.bgGreen.black(` ${scoreStr} HIGH `);
    case "medium":
      return chalk.bgYellow.black(` ${scoreStr} MED  `);
    case "low":
      return chalk.bgRed.white(` ${scoreStr} LOW  `);
    default:
      return chalk.dim(`[${scoreStr}]`);
  }
}
