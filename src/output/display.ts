import chalk from "chalk";
import { DiffResult } from "../differ/index.js";
import { HealResult } from "../healer/index.js";

export function displayDiffResult(result: DiffResult): void {
  console.log();
  console.log(
    chalk.bold(`API: ${result.apiName}`) +
      chalk.dim(
        ` (${result.oldVersion ?? "?"} → ${result.newVersion ?? "?"})`,
      ),
  );
  console.log();

  if (result.changes.length === 0) {
    console.log(chalk.green("  ✓ No changes detected."));
    return;
  }

  const breaking = result.changes.filter((c) => c.severity === "breaking");
  const nonBreaking = result.changes.filter(
    (c) => c.severity === "non-breaking",
  );
  const info = result.changes.filter((c) => c.severity === "info");

  if (breaking.length > 0) {
    console.log(chalk.red.bold(`  ⚠ ${breaking.length} breaking change(s):`));
    for (const c of breaking) {
      console.log(chalk.red(`    ✗ ${c.description}`));
    }
    console.log();
  }

  if (nonBreaking.length > 0) {
    console.log(
      chalk.yellow(`  △ ${nonBreaking.length} non-breaking change(s):`),
    );
    for (const c of nonBreaking) {
      console.log(chalk.yellow(`    ○ ${c.description}`));
    }
    console.log();
  }

  if (info.length > 0) {
    console.log(chalk.dim(`  ℹ ${info.length} info change(s):`));
    for (const c of info) {
      console.log(chalk.dim(`    · ${c.description}`));
    }
    console.log();
  }
}

export function displayHealResult(
  result: HealResult,
  patchId?: string,
): void {
  console.log();
  console.log(chalk.bold.green(`Heal complete for: ${result.apiName}`));
  console.log();

  if (result.patches.length === 0) {
    console.log(chalk.dim("  No code changes needed."));
    return;
  }

  console.log(
    chalk.white(`  ${result.patches.length} file(s) would be updated:`),
  );
  console.log();

  for (const patch of result.patches) {
    console.log(chalk.cyan(`    ${patch.filePath}`));
    console.log(chalk.dim(`      ${patch.description}`));
  }

  if (patchId) {
    console.log();
    console.log(
      chalk.white(`  Patch saved: `) +
        chalk.bold(`.contractbot/patches/${patchId}/`),
    );
    console.log();
    console.log(
      chalk.dim(`  Apply with: `) + chalk.white(`contractbot apply ${patchId}`),
    );
  }
}
