import { readFile, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import chalk from "chalk";

interface ApplyOptions {
  config: string;
}

interface PatchMetadata {
  apiName: string;
  createdAt: string;
  files: Array<{ path: string; description: string }>;
}

export async function applyCommand(
  patchId: string,
  options: ApplyOptions,
): Promise<void> {
  void options;
  const patchDir = join(".apihealer/patches", patchId);

  if (!existsSync(patchDir)) {
    console.log(chalk.red(`Patch not found: ${patchId}`));
    console.log(chalk.dim("Run \"apihealer heal\" first to generate patches."));
    return;
  }

  const metadataPath = join(patchDir, "metadata.json");
  const raw = await readFile(metadataPath, "utf-8");
  const metadata = JSON.parse(raw) as PatchMetadata;

  console.log();
  console.log(chalk.bold(`Applying patch: ${patchId}`));
  console.log(chalk.dim(`API: ${metadata.apiName} | Created: ${metadata.createdAt}`));
  console.log();

  const patchFiles = await readdir(patchDir);
  const patchedFiles = patchFiles.filter((f) => f.startsWith("patched-"));

  let applied = 0;

  for (const patchFile of patchedFiles) {
    const originalPath = patchFile
      .replace(/^patched-/, "")
      .replace(/__/g, "/");

    if (!existsSync(originalPath)) {
      console.log(chalk.yellow(`  ⊘ Skipped (file not found): ${originalPath}`));
      continue;
    }

    const patchedContent = await readFile(join(patchDir, patchFile), "utf-8");
    await writeFile(originalPath, patchedContent, "utf-8");
    console.log(chalk.green(`  ✓ Applied: ${originalPath}`));
    applied++;
  }

  console.log();
  if (applied > 0) {
    console.log(chalk.green.bold(`✓ ${applied} file(s) updated.`));
    console.log(chalk.dim("Review the changes with: git diff"));
  } else {
    console.log(chalk.yellow("No files were updated."));
  }
}
