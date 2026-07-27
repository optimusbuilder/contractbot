import { readFile, writeFile, readdir, mkdir, copyFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import chalk from "chalk";
import { createTwoFilesPatch } from "diff";
import { logger } from "../../logger.js";

interface ApplyOptions {
  config: string;
  minConfidence?: string;
  interactive?: boolean;
  undo?: boolean;
}

interface PatchMetadata {
  apiName: string;
  createdAt: string;
  files: Array<{ path: string; description: string }>;
  scores?: Array<{ path: string; confidence: string; score: number }>;
}

const HISTORY_PATH = ".apihealer/history.json";
const BACKUP_DIR = ".apihealer/backups";

interface HistoryEntry {
  patchId: string;
  appliedAt: string;
  filesModified: string[];
}

export async function applyCommand(
  patchId: string,
  options: ApplyOptions,
): Promise<void> {
  if (options.undo) {
    await undoApply(patchId);
    return;
  }

  const patchDir = join(".apihealer/patches", patchId);

  if (!existsSync(patchDir)) {
    logger.error(`Patch not found: ${patchId}`, { patchId, event: "patch_not_found" });
    if (!logger.isJsonMode()) {
      console.log(chalk.dim("Run \"apihealer heal\" first to generate patches."));
    }
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
  let patchedFiles = patchFiles.filter((f) => f.startsWith("patched-"));

  if (options.minConfidence && metadata.scores) {
    const minLevel = options.minConfidence;
    const allowedPaths = metadata.scores
      .filter((s) => meetsConfidenceThreshold(s.confidence, minLevel))
      .map((s) => s.path);

    const before = patchedFiles.length;
    patchedFiles = patchedFiles.filter((f) => {
      const originalPath = f.replace(/^patched-/, "").replace(/__/g, "/");
      return allowedPaths.includes(originalPath);
    });

    if (patchedFiles.length < before) {
      console.log(
        chalk.dim(`  Filtered to ${patchedFiles.length}/${before} files (min confidence: ${minLevel})`),
      );
      console.log();
    }
  }

  await mkdir(BACKUP_DIR, { recursive: true });
  const backupId = `${patchId}-${Date.now()}`;
  const backupPath = join(BACKUP_DIR, backupId);
  await mkdir(backupPath, { recursive: true });

  let applied = 0;
  const appliedPaths: string[] = [];

  for (const patchFile of patchedFiles) {
    const originalPath = patchFile
      .replace(/^patched-/, "")
      .replace(/__/g, "/");

    if (!existsSync(originalPath)) {
      console.log(chalk.yellow(`  ⊘ Skipped (file not found): ${originalPath}`));
      continue;
    }

    const currentContent = await readFile(originalPath, "utf-8");
    const patchedContent = await readFile(join(patchDir, patchFile), "utf-8");

    if (options.interactive) {
      const shouldApply = await showInteractiveDiff(
        originalPath,
        currentContent,
        patchedContent,
      );
      if (!shouldApply) {
        console.log(chalk.dim(`  ⊘ Skipped by user: ${originalPath}`));
        continue;
      }
    }

    const safeBackupName = originalPath.replace(/[/\\]/g, "__");
    await writeFile(join(backupPath, safeBackupName), currentContent, "utf-8");

    await writeFile(originalPath, patchedContent, "utf-8");
    console.log(chalk.green(`  ✓ Applied: ${originalPath}`));
    applied++;
    appliedPaths.push(originalPath);
  }

  if (applied > 0) {
    await recordHistory({
      patchId,
      appliedAt: new Date().toISOString(),
      filesModified: appliedPaths,
    });
  }

  logger.info(applied > 0 ? "Patch applied" : "No files updated", {
    event: "apply_complete",
    patchId,
    applied,
    backupId,
    files: appliedPaths,
  });

  if (!logger.isJsonMode()) {
    console.log();
    if (applied > 0) {
      console.log(chalk.green.bold(`✓ ${applied} file(s) updated.`));
      console.log(chalk.dim(`  Backup saved: ${backupPath}`));
      console.log(chalk.dim(`  Undo with: apihealer apply --undo ${backupId}`));
      console.log(chalk.dim("  Review changes: git diff"));
    } else {
      console.log(chalk.yellow("No files were updated."));
    }
  }
}

export async function undoApply(backupId: string): Promise<void> {
  const backupPath = join(BACKUP_DIR, backupId);

  if (!existsSync(backupPath)) {
    console.log(chalk.red(`Backup not found: ${backupId}`));
    return;
  }

  const files = await readdir(backupPath);
  let restored = 0;

  for (const file of files) {
    const originalPath = file.replace(/__/g, "/");
    const backupContent = await readFile(join(backupPath, file), "utf-8");
    await writeFile(originalPath, backupContent, "utf-8");
    console.log(chalk.green(`  ✓ Restored: ${originalPath}`));
    restored++;
  }

  console.log();
  console.log(chalk.green.bold(`✓ ${restored} file(s) restored from backup.`));
}

async function showInteractiveDiff(
  filePath: string,
  original: string,
  patched: string,
): Promise<boolean> {
  const diff = createTwoFilesPatch(filePath, filePath, original, patched, "before", "after", { context: 3 });
  const lines = diff.split("\n").slice(2);

  console.log();
  console.log(chalk.cyan.bold(`  ${filePath}:`));
  const previewLines = lines.slice(0, 20);
  for (const line of previewLines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      console.log(chalk.green(`    ${line}`));
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      console.log(chalk.red(`    ${line}`));
    } else if (line.startsWith("@@")) {
      console.log(chalk.cyan(`    ${line}`));
    } else {
      console.log(chalk.dim(`    ${line}`));
    }
  }
  if (lines.length > 20) {
    console.log(chalk.dim(`    ... ${lines.length - 20} more lines`));
  }

  // In non-TTY (CI) environments, auto-accept
  if (!process.stdin.isTTY) return true;

  const answer = await prompt(chalk.white("  Apply this change? [Y/n/s(kip)] "));
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data) => {
      resolve(data.toString());
    });
  });
}

function meetsConfidenceThreshold(level: string, min: string): boolean {
  const rank: Record<string, number> = { high: 3, medium: 2, low: 1 };
  return (rank[level] ?? 0) >= (rank[min] ?? 0);
}

async function recordHistory(entry: HistoryEntry): Promise<void> {
  let history: HistoryEntry[] = [];
  if (existsSync(HISTORY_PATH)) {
    const raw = await readFile(HISTORY_PATH, "utf-8");
    history = JSON.parse(raw) as HistoryEntry[];
  }
  history.push(entry);
  await mkdir(".apihealer", { recursive: true });
  await writeFile(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}
