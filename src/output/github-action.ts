import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { join, resolve } from "path";

export interface WriteGithubActionOptions {
  /** Project root (default: cwd). */
  dir?: string;
  /** Git ref for the Contractbot action. Pin this to a release tag or commit in production. */
  ref?: string;
  /** Overwrite an existing workflow file. */
  force?: boolean;
}

export interface WriteGithubActionResult {
  path: string;
  created: boolean;
  skipped: boolean;
}

/** Relative workflow path from project root. */
export const GITHUB_ACTION_RELATIVE_PATH = ".github/workflows/contractbot.yml";

/**
 * Build the scheduled compatibility-check GitHub Actions workflow YAML.
 */
export function buildGithubActionYaml(ref = "v0"): string {
  return `name: contractbot — external API compatibility check

# Pin the action ref to a release tag or commit before using it in production.
on:
  schedule:
    # Every four hours. Edit this cron expression to choose your own cadence.
    - cron: '17 */4 * * *'
  workflow_dispatch:
  pull_request:
    branches: [main, master]

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: optimusbuilder/contractbot@${ref}
        with:
          fail-on: breaking
`;
}

/**
 * Write `.github/workflows/contractbot.yml` under the project directory.
 */
export async function writeGithubAction(
  options: WriteGithubActionOptions = {},
): Promise<WriteGithubActionResult> {
  const projectDir = resolve(options.dir ?? ".");
  const workflowPath = join(projectDir, GITHUB_ACTION_RELATIVE_PATH);

  if (existsSync(workflowPath) && !options.force) {
    return { path: workflowPath, created: false, skipped: true };
  }

  await mkdir(join(projectDir, ".github", "workflows"), { recursive: true });
  await writeFile(workflowPath, buildGithubActionYaml(options.ref), "utf-8");

  return { path: workflowPath, created: true, skipped: false };
}
